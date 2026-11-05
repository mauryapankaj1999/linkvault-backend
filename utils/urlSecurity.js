
const dns = require("dns").promises;
const net = require("net");
const ipaddr = require("ipaddr.js");

const validateUrl = async (url) => {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Valid URL is required");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  // Block URLs containing credentials
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const hostname = parsedUrl.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  // Block localhost and local domains
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Localhost URLs are not allowed");
  }

  let addresses;

  try {
    if (net.isIP(hostname)) {
      addresses = [{ address: hostname }];
    } else {
      addresses = await dns.lookup(hostname, { all: true });
    }
  } catch {
    throw new Error("Unable to resolve hostname");
  }

  if (!addresses.length) {
    throw new Error("Unable to resolve hostname");
  }

  // Reject private, loopback, link-local and reserved addresses
  for (const item of addresses) {
    const address = ipaddr.parse(item.address);

    if (address.range() !== "unicast") {
      throw new Error(
        "Private or unsafe IP addresses are not allowed"
      );
    }
  }

  return parsedUrl;
};

module.exports = validateUrl;
