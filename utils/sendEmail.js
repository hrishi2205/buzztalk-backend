const sgMail = require("@sendgrid/mail");
const dotenv = require("dotenv");
dotenv.config();
// Set the API key for SendGrid from your environment variables
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends an email using SendGrid.
 * Supports both raw emails and dynamic templates.
 *
 * @param {object} options - The email options.
 * @param {string} options.to - The recipient's email address.
 * @param {string} [options.subject] - The subject line (only for non-template emails).
 * @param {string} [options.text] - Plain text body (optional).
 * @param {string} [options.html] - HTML body (optional).
 * @param {string} [options.templateId] - SendGrid dynamic template ID.
 * @param {object} [options.dynamicTemplateData] - Data for dynamic templates.
 */
const sendEmail = async (options) => {
  const msg = {
    to: options.to,
    from: {
      name: "BuzzTalk",
      email: process.env.SENDER_EMAIL, // verified sender email
    },
  };

  if (options.templateId) {
    // Use SendGrid Dynamic Template
    msg.templateId = options.templateId;
    msg.dynamicTemplateData = options.dynamicTemplateData || {};
  } else {
    // Use plain email
    msg.subject = options.subject;
    msg.text = options.text;
    msg.html = options.html;
  }

  try {
    await sgMail.send(msg);
    console.log(`Email sent successfully to ${options.to}`);
  } catch (error) {
    console.error("Error sending email:", error);

    if (error.response) {
      console.error(error.response.body);
    }

    throw new Error("Email could not be sent.");
  }
};

module.exports = sendEmail;
