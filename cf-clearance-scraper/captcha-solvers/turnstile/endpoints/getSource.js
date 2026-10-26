const getCfSource = require("./source/cloudflare.js");
const getHcapSource = require("./source/hcaptcha.js");
const getF5Source = require("./source/f5.js");

function getSource(config) {
  const action = config.action || "cloudflare";
  switch (action) {
    case "cloudflare":
      return getCfSource(config);
    case "hcaptcha":
      return getHcapSource(config);
    case "f5":
      return getF5Source(config);
  }
}
module.exports = getSource;
