const nodemailer = require("nodemailer");
const pdf = require("html-pdf");
const fs = require("fs");
const path = require("path");
const sendEmail = async (emailPayload) => {
  let senderFailures = [];
  let receiverFailures = [];
  let totalSenders = 0;
  const startTime = Date.now(); // Start time for tracking response time

  for (const emailData of emailPayload) {
    const {
      senderEmail,
      senderPassword,
      receiverEmail,
      senderName,
      receiverContent = "",
      filename = "",
      fileType = "",
      subject = "No Subject",
      receiverAttachment = null,
    } = emailData;

    if (!senderEmail || !receiverEmail) {
      console.error("Sender or receiver email is missing.");
      continue;
    }

    totalSenders++; // Increment sender count

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: senderPassword,
      },
    });

    let tempFilePath;
    if (receiverAttachment) {
      tempFilePath = path.join(__dirname, `${filename}.${fileType.toLowerCase()}`);
    }
    let attachments = [];

    try {
      if (receiverAttachment && fileType.toLowerCase() === "pdf") {
        // Create the PDF if the attachment exists
        await new Promise((resolve, reject) => {
          pdf.create(receiverAttachment).toFile(tempFilePath, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        attachments.push({
          filename: `${filename}.pdf`,
          path: tempFilePath,
          contentType: "application/pdf",
        });
      } else if (receiverAttachment && fileType.toLowerCase() === "image") {
        // Write the image data if it exists
        fs.writeFileSync(tempFilePath, receiverAttachment);

        attachments.push({
          filename: `${filename}.png`,
          path: tempFilePath,
          contentType: "image/png",
        });
      }
      const mailOptions = {
        from: `${senderName || "No Name"} <${senderEmail}>`,
        to: receiverEmail.trim(),
        subject: (subject || "").replace(/<[^>]*>/g, ""),
        text: (receiverContent || "").replace(/<[^>]*>/g, ""),
        attachments: attachments.length ? attachments : undefined, // Only add attachments if they exist
      };

      totalReceivers++; // Increment receiver count
      const info = await transporter.sendMail(mailOptions);
      console.log(`Message sent from ${senderEmail} to ${receiverEmail}: %s`, info.messageId);
    } catch (error) {
      console.error(`Error sending email from ${senderEmail} to ${receiverEmail}:`, error.message);

      if (!senderFailures.includes(senderEmail)) senderFailures.push(senderEmail);
      if (!receiverFailures.includes(receiverEmail)) receiverFailures.push(receiverEmail);
    } finally {
      // Clean up: Remove the file only if it was created
      if (fs?.existsSync(tempFilePath) && tempFilePath) {
        fs?.unlinkSync(tempFilePath);
      }
    }
  }

  const endTime = Date.now();
  const responseTime = (endTime - startTime) / 1000;

  return {
    totalSenders,
    senderFailures: senderFailures.length,
    totalReceivers,
    receiverFailures: receiverFailures.length,
    responseTime: `${responseTime} seconds`,
  };
};

module.exports = { sendEmail };