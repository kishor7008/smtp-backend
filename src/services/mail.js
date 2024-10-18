const nodemailer = require("nodemailer");
const pdf = require("html-pdf");
const fs = require("fs");
const path = require("path");

const sendEmail = async (emailPayload) => {
  let senderFailures = [];
  let receiverFailures = [];
  let totalSenders = 0;
  let totalReceivers = 0;

  const startTime = Date.now(); // Start time for tracking response time

  // Loop over each email data in the payload
  for (const emailData of emailPayload) {
    const {
      senderEmail,
      senderPassword,
      receiverEmail,
      senderName,
      receiverContent,
      filename,
      fileType,
      subject,
      receiverAttachment
    } = emailData;

    totalSenders++; // Increment sender count

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: senderPassword,
      },
    });

    // Define the path for the temporary file based on fileType
    const tempFilePath = path.join(__dirname, `${filename}.${fileType.toLowerCase()}`);

    if (fileType.toLowerCase() === 'pdf') {
      // Create the PDF from HTML content
      pdf.create(receiverAttachment).toFile(tempFilePath, async (err, res) => {
        if (err) {
          console.error("Error creating PDF:", err);
          return; // Exit the callback early if there's an error
        }

        try {
          totalReceivers++; // Increment receiver count

          const mailOptions = {
            from: `${senderName} <${senderEmail}>`, // sender address
            to: receiverEmail.trim(), // receiver email, trim spaces
            subject: subject.replace(/<[^>]*>/g, ""), // Subject line
            text: receiverContent.replace(/<[^>]*>/g, ""), // Convert HTML content to plain text
            attachments: [
              {
                filename: `${filename}.pdf`, // The name of the PDF file to be sent
                path: tempFilePath, // Path to the temporary PDF file
                contentType: "application/pdf", // Content type for PDF
              },
            ],
          };

          const info = await transporter.sendMail(mailOptions);
          console.log(`Message sent from ${senderEmail} to ${receiverEmail}: %s`, info.messageId);
        } catch (error) {
          console.error(`Error sending email from ${senderEmail} to ${receiverEmail}:`, error.message);

          // Track sender and receiver failures
          if (!senderFailures.includes(senderEmail)) {
            senderFailures.push(senderEmail);
          }
          if (!receiverFailures.includes(receiverEmail)) {
            receiverFailures.push(receiverEmail);
          }
        } finally {
          // Clean up: remove the temporary file after sending the email
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          } else {
            console.log(`File does not exist, cannot unlink: ${tempFilePath}`);
          }
        }
      });
    } else if (fileType.toLowerCase() === 'image') {
      // Assuming receiverContent can be used for the image data in this case
      fs.writeFileSync(tempFilePath, receiverAttachment); // Create an image file

      try {
        totalReceivers++; // Increment receiver count

        const mailOptions = {
          from: `${senderName} <${senderEmail}>`, // sender address
          to: receiverEmail.trim(), // receiver email, trim spaces
          subject: "Your Subject Here", // Subject line
          text: receiverContent.replace(/<[^>]*>/g, ""), // Convert HTML content to plain text
          html: receiverContent, // Send HTML content directly
          attachments: [
            {
              filename: `${filename}.png`, // The name of the image file to be sent
              path: tempFilePath, // Path to the temporary image file
              contentType: "image/png", // Content type for PNG
            },
          ],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Message sent from ${senderEmail} to ${receiverEmail}: %s`, info.messageId);
      } catch (error) {
        console.error(`Error sending email from ${senderEmail} to ${receiverEmail}:`, error.message);

        // Track sender and receiver failures
        if (!senderFailures.includes(senderEmail)) {
          senderFailures.push(senderEmail);
        }
        if (!receiverFailures.includes(receiverEmail)) {
          receiverFailures.push(receiverEmail);
        }
      } finally {
        // Clean up: remove the temporary file after sending the email
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        } else {
          console.log(`File does not exist, cannot unlink: ${tempFilePath}`);
        }
      }
    } else {
      console.error(`Unsupported file type: ${fileType}`);
    }
  }

  const endTime = Date.now(); // End time for tracking response time
  const responseTime = (endTime - startTime) / 1000; // Calculate response time in seconds

  // Return the failure records and additional information
  return {
    totalSenders,
    senderFailures: senderFailures.length,
    totalReceivers,
    receiverFailures: receiverFailures.length,
    responseTime: `${responseTime} seconds`,
  };
};

module.exports = { sendEmail };
