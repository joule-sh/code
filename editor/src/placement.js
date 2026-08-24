const CONTEXT_KEY = "joule.secondarySidebar";
const SINCE_MAJOR = 1;
const SINCE_MINOR = 106;

const ACTIVITY_BAR = { container: "joule", view: "joule.chat" };
const SECONDARY_SIDEBAR = { container: "joule-secondary", view: "joule.chat.secondary" };

function supportsSecondarySidebar(version) {
  const parsed = /^(\d+)\.(\d+)/.exec(String(version || ""));
  if (parsed === null) { return false; }
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  if (major !== SINCE_MAJOR) { return major > SINCE_MAJOR; }
  return minor >= SINCE_MINOR;
}

function placementFor(version) {
  return supportsSecondarySidebar(version) ? SECONDARY_SIDEBAR : ACTIVITY_BAR;
}

module.exports = { CONTEXT_KEY, ACTIVITY_BAR, SECONDARY_SIDEBAR, supportsSecondarySidebar, placementFor };
