/* SPDX-License-Identifier: Apache-2.0 */
/* WP09 UI SKIP policy: only an explicit host/sandbox refusal to spawn or
   connect Electron may be SKIP. Generic startup/ready failures, renderer
   crashes, missing dependencies and assertion errors remain FAIL. */
'use strict';

module.exports = function isEnvironmentDenial(detail) {
  var s = String(detail == null ? '' : detail);
  // "platform_channel.cc: connection closed" is a generic startup failure and
  // must remain FAIL. Only an OS permission denial (EPERM/EACCES or an explicit
  // denied message) is an environment SKIP.
  return /\bspawn\s+(EPERM|EACCES)\b|\b(?:EPERM|EACCES)\b|permission denied|access denied|sandbox[^\n]*(?:denied|EPERM|EACCES)/i.test(s);
};
