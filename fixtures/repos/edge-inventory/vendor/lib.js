// vendored copy of leftpad 1.3.0
module.exports = function leftpad(str, len, ch) {
  str = String(str);
  ch = ch === undefined ? " " : String(ch);
  while (str.length < len) str = ch + str;
  return str;
};
