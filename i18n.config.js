const _config = {
  "importStatement": "import { I18N } from '@common/I18N';",
  "callStatement": "I18N.get",
  "targetDir": "i18n-messages",
  "exclude": [],
  "textPattern": /[\u4e00-\u9fa5]/,
  "autoZhKey": true,
  "getKey": (item) => { // 重写资源Key
    return "CONSOLE_KEY_" + Math.random(1000);
  }
}
const path = require('path');
module.exports = function () {
  let config = {};
  try {
    config = require(path.join(process.cwd(), 'i18n.config.js'));
  } catch (e) {
    config = {};
  }
  return Object.assign({}, _config, config);
}
