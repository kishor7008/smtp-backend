const express = require("express");
const { sendEmail } = require("./src/services/mail");
const multer = require("multer");
const cors = require("cors");
require('dotenv').config(); 
const AWS = require('aws-sdk');
const os = require('os');
const app = express();
AWS.config.update({ region: 'ap-south-1' });

const ec2 = new AWS.EC2();

app.use(express.json());
app.use(cors())
const upload = multer(); // Use the multer instance for handling multipart form-data
function getServerIPs() {
  const networkInterfaces = os.networkInterfaces();
  const ips = [];

  for (const interfaceName in networkInterfaces) {
      for (const net of networkInterfaces[interfaceName]) {
          if (net.family === 'IPv4' && !net.internal) {
              ips.push(net.address);
          }
      }
  }

  return {
      totalIPs: ips.length,
      runningIPs: ips,
  };
}
app.get('/ips', (req, res) => {
  const ipInfo = getServerIPs();
  res.json(ipInfo);
});
function getServerIPs() {
  const networkInterfaces = os.networkInterfaces();
  const ips = [];

  for (const interfaceName in networkInterfaces) {
      for (const net of networkInterfaces[interfaceName]) {
          if (net.family === 'IPv4' && !net.internal) {
              ips.push(net.address);
          }
      }
  }

  return {
      totalIPs: ips.length,
      runningIPs: ips,
  };
}

/**
* API: Get Running IPs
*/
app.get('/api/ips', (req, res) => {
  const ipInfo = getServerIPs();
  res.json(ipInfo);
});
app.post('/api/refresh-ip', express.json(), async (req, res) => {
  const { instanceId } = req.body;

  if (!instanceId) {
      return res.status(400).json({ error: 'Instance ID is required.' });
  }

  try {
      // Allocate a new Elastic IP
      const allocation = await ec2.allocateAddress().promise();
      const allocationId = allocation.AllocationId;

      // Associate the new Elastic IP with the given instance
      await ec2.associateAddress({
          InstanceId: instanceId,
          AllocationId: allocationId,
      }).promise();

      res.json({
          message: 'IP refreshed successfully',
          newIp: allocation.PublicIp,
      });
  } catch (error) {
      console.error('Error refreshing IP:', error);
      res.status(500).json({ error: 'Failed to refresh IP' });
  }
});
// i-0e4dac2309c87b0fc
app.post("/send-email", upload.any(), async (req, res) => {
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
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
