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
const { sendEmail } = require('./src/services/mail');

const app = express();
const PORT = 3000;
app.use(express.json());
const upload = multer(); // For handling multipart form-data

// AWS EC2 client
const ec2 = new EC2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '<your-access-key-id>',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '<your-secret-access-key>',
  },
});

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
      publicIps: instance.NetworkInterfaces.flatMap(ni =>
        ni.Association?.PublicIp ? [ni.Association.PublicIp] : []
      ),
      privateIps: instance.NetworkInterfaces.flatMap(ni =>
        ni.PrivateIpAddresses.map(ipInfo => ipInfo.PrivateIpAddress)
      ),
      // Collecting all public IPs from possible multiple IP associations
      allPublicIps: instance.NetworkInterfaces.flatMap(ni =>
        ni.PrivateIpAddresses
          .filter(ipInfo => ipInfo.Association?.PublicIp)
          .map(ipInfo => ipInfo.Association.PublicIp)
      ),
    }));

    res.json(ips);
  } catch (error) {
    console.error('Error fetching EC2 IPs:', error);
    res.status(500).send('Failed to fetch EC2 IPs');
  }
});



// Route: Refresh IPs based on conditions and create new IPs
app.post('/ec2/refresh-ips/:count', async (req, res) => {
  const ipCount = parseInt(req.params.count);

  try {
    // Step 1: Get running instances
    const instancesCommand = new DescribeInstancesCommand({});
    const instances = await ec2.send(instancesCommand);
    const runningInstances = instances.Reservations.flatMap(r =>
      r.Instances.filter(i => i.State.Name === 'running')
    );

    console.log('Running instances:', runningInstances);  // Log for verification

    // Optional: Relax the condition to proceed with fewer instances
    if (runningInstances.length === 0) {
      return res.status(400).json({
        message: 'No running instances found.',
      });
    }

    // Step 2: Retrieve existing Elastic IPs
    const describeAddressesCommand = new DescribeAddressesCommand({});
    const addressResult = await ec2.send(describeAddressesCommand);
    const existingIps = addressResult.Addresses;

    console.log('Existing IPs:', existingIps);  // Log for verification

    // Step 3: Release all existing IPs
    const releasePromises = existingIps.map(ip => {
      const releaseCommand = new ReleaseAddressCommand({ AllocationId: ip.AllocationId });
      return ec2.send(releaseCommand);
    });

    await Promise.all(releasePromises);
    console.log('Released all existing Elastic IPs.');

    // Step 4: Allocate new Elastic IPs (distribute IPs across instances)
    const newIps = [];
    const allocationPromises = Array.from({ length: ipCount }, async () => {
      const allocateCommand = new AllocateAddressCommand({ Domain: 'vpc' });
      const result = await ec2.send(allocateCommand);
      newIps.push({ AllocationId: result.AllocationId, PublicIp: result.PublicIp });
      return result;
    });

    await Promise.all(allocationPromises);
    console.log('Allocated new Elastic IPs:', newIps);

    // Step 5: Associate IPs to instances
    const instanceAssociations = runningInstances.map(async (instance, index) => {
      const ip = newIps[index % newIps.length];  // Distribute IPs in a round-robin manner
      const associateCommand = new AssociateAddressCommand({
        InstanceId: instance.InstanceId,
        AllocationId: ip.AllocationId,
      });
      await ec2.send(associateCommand);
      console.log(`Associated IP ${ip.PublicIp} with instance ${instance.InstanceId}`);
    });

    await Promise.all(instanceAssociations);

    // Step 6: Return response with allocated and associated IPs
    res.json({
      message: `Allocated and associated ${ipCount} Elastic IPs.`,
      newIps,
    });
  } catch (error) {
    console.error('Error refreshing Elastic IPs:', error);
    res.status(500).send('Failed to refresh IPs');
  }
});


app.post('/ec2/refresh-ip/:instanceId', async (req, res) => {
  const instanceId = req.params.instanceId;

  try {
    // Step 1: Describe the existing Elastic IP associated with the instance
    const describeCommand = new DescribeAddressesCommand({ Filters: [{ Name: 'instance-id', Values: [instanceId] }] });
    const { Addresses } = await ec2.send(describeCommand);
    
    if (Addresses.length === 0) {
      return res.status(400).json({ message: 'No Elastic IP found for this instance.' });
    }

    const oldAllocationId = Addresses[0].AllocationId;

    // Step 2: Release the old Elastic IP
    const releaseCommand = new ReleaseAddressCommand({ AllocationId: oldAllocationId });
    await ec2.send(releaseCommand);

    // Step 3: Allocate a new Elastic IP
    const allocateCommand = new AllocateAddressCommand({ Domain: 'vpc' });
    const allocation = await ec2.send(allocateCommand);

    // Step 4: Associate the new IP with the EC2 instance
    const associateCommand = new AssociateAddressCommand({
      InstanceId: instanceId,
      AllocationId: allocation.AllocationId,
    });
    await ec2.send(associateCommand);

    res.json({
      message: 'IP address refreshed and associated with the same EC2 instance',
      newPublicIp: allocation.PublicIp,
    });
  } catch (error) {
    console.error('Error refreshing IP:', error);
    res.status(500).send('Failed to refresh IP');
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
