const express = require("express");
const { sendEmail } = require("./src/services/mail");
const multer = require("multer");
const cors = require("cors");
require('dotenv').config(); 
const app = express();

app.use(express.json());
app.use(cors())
const upload = multer(); // Use the multer instance for handling multipart form-data

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
