const express = require('express');
require('dotenv').config();
const multer = require('multer');
const { 
  EC2Client, 
  DescribeInstancesCommand, 
  ReleaseAddressCommand, 
  DescribeAddressesCommand, 
  AllocateAddressCommand, 
  AssociateAddressCommand 
} = require('@aws-sdk/client-ec2');
const { 
  Route53Client, 
  ChangeResourceRecordSetsCommand 
} = require('@aws-sdk/client-route-53');
const { sendEmail } = require('./src/services/mail');

const app = express();
const PORT = 3000;
app.use(express.json());
const upload = multer(); // For handling multipart form-data

// AWS EC2 and Route 53 clients
const ec2 = new EC2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '<your-access-key-id>',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '<your-secret-access-key>',
  },
});
const route53 = new Route53Client({ region: process.env.AWS_REGION });

const HOSTED_ZONE_ID = 'Z01693807FDPMRPZ0P9D'; // Replace with your hosted zone ID
const DOMAIN_NAME = 'amayra.amayra.com'; // Replace with your domain name

// Route: Fetch running EC2 instance IPs
app.get('/ec2/ips', async (req, res) => {
  try {
    const command = new DescribeInstancesCommand({});
    const instances = await ec2.send(command);

    const runningInstances = instances.Reservations.flatMap(r =>
      r.Instances.filter(i => i.State.Name === 'running')
    );

    const ips = runningInstances.map(instance => ({
      instanceId: instance.InstanceId,
      publicIp: instance.PublicIpAddress || 'N/A',
      privateIp: instance.PrivateIpAddress,
    }));
    res.json(ips);
  } catch (error) {
    console.error('Error fetching EC2 IPs:', error);
    res.status(500).send('Failed to fetch EC2 IPs');
  }
});

// Route: Refresh multiple Elastic IPs and update Route 53 DNS
app.post('/ec2/refresh-ips/:count', async (req, res) => {
  const ipCount = parseInt(req.params.count);

  try {
    // Step 1: Retrieve existing Elastic IPs
    const describeAddressesCommand = new DescribeAddressesCommand({});
    const addressResult = await ec2.send(describeAddressesCommand);
    const existingIps = addressResult.Addresses;

    // Step 2: Release unassociated IPs
    const releasePromises = existingIps
      .filter(ip => !ip.InstanceId) // Only unassociated IPs
      .map(ip => {
        const releaseCommand = new ReleaseAddressCommand({ AllocationId: ip.AllocationId });
        return ec2.send(releaseCommand);
      });

    if (releasePromises.length > 0) {
      await Promise.all(releasePromises);
      console.log(`Released IPs: ${existingIps.filter(ip => !ip.InstanceId).map(ip => ip.PublicIp)}`);
    } else {
      console.log('No unassociated IPs to release.');
    }

    // Step 3: Allocate new Elastic IPs
    const newIps = [];
    const allocationPromises = Array.from({ length: ipCount }, async () => {
      const allocateCommand = new AllocateAddressCommand({ Domain: 'vpc' });
      const result = await ec2.send(allocateCommand);
      newIps.push(result.PublicIp);
      return result;
    });

    await Promise.all(allocationPromises);
    console.log('Allocated new Elastic IPs:', newIps);

    // Step 4: Prepare Route 53 DNS update with all IPs in a single record
    const changeBatch = {
      Changes: [
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: `${DOMAIN_NAME}.`, // Ensure absolute DNS name with trailing dot
            Type: 'A',
            TTL: 300,
            ResourceRecords: newIps.map(ip => ({ Value: ip })), // All IPs under the same record
          },
        },
      ],
    };

    // Step 5: Execute Route 53 DNS update
    const route53Command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: HOSTED_ZONE_ID,
      ChangeBatch: changeBatch,
    });

    await route53.send(route53Command);
    console.log('Updated Route 53 DNS records.');

    // Step 6: Return response
    res.json({
      message: `Allocated ${ipCount} new Elastic IPs and associated them with Route 53 DNS record.`,
      newIps,
    });
  } catch (error) {
    console.error('Error refreshing Elastic IPs or updating Route 53:', error);
    res.status(500).send('Failed to refresh IPs and update Route 53');
  }
});


// Route: Refresh a single EC2 instance's IP and update Route 53 DNS
app.post('/ec2/refresh-ip/:instanceId', async (req, res) => {
  const instanceId = req.params.instanceId;

  try {
    // Step 1: Allocate a new Elastic IP
    const allocateCommand = new AllocateAddressCommand({ Domain: 'vpc' });
    const allocation = await ec2.send(allocateCommand);

    // Step 2: Associate the new IP with the EC2 instance
    const associateCommand = new AssociateAddressCommand({
      InstanceId: instanceId,
      AllocationId: allocation.AllocationId,
    });
    await ec2.send(associateCommand);

    // Step 3: Update Route 53 with the new IP
    const changeBatch = {
      Changes: [
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: `${DOMAIN_NAME}.`,
            Type: 'A',
            TTL: 300,
            ResourceRecords: [{ Value: allocation.PublicIp }],
          },
        },
      ],
    };

    const route53Command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: HOSTED_ZONE_ID,
      ChangeBatch: changeBatch,
    });

    await route53.send(route53Command);
    console.log('Updated Route 53 DNS records.');

    res.json({
      message: 'New IP allocated, associated, and DNS updated',
      publicIp: allocation.PublicIp,
    });
  } catch (error) {
    console.error('Error refreshing IP:', error);
    res.status(500).send('Failed to refresh IP and update DNS');
  }
});

// Route: Send email
app.post("/send-email", upload.none(), async (req, res) => {
  try {
    const {
      totalSenders,
      senderFailures,
      totalReceivers,
      receiverFailures,
      responseTime,
    } = await sendEmail(req.body);
    res.status(200).json({
      message: "Emails sent",
      totalSenders,
      senderFailures,
      totalReceivers,
      receiverFailures,
      responseTime,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Error sending email" });
  }
});

// Start the server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
