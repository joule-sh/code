var jouleFirstRun = (function () {
  const { el, post, button, wordmark } = jouleDom;

  const LEAD = "joule is a coding agent that works in the folder this window has open. "
    + "it runs on the machine that holds the files, and it asks before it changes them.";

  const ASK = "it needs a way to reach a model. the three routes are:";

  const ROUTES = [
    {
      route: "account",
      title: "a joule account",
      why: "sign in through the browser and use the models the platform provides. "
        + "the sign-in itself happens in a terminal, and this opens one for you.",
    },
    {
      route: "key",
      title: "your own provider key",
      why: "a base url and an api key for a model you already pay for. "
        + "it goes in the config file, which this opens: the panel never asks you to type a key, so it never holds one.",
    },
    {
      route: "server",
      title: "a self-hosted joule server",
      why: "point joule at a server you run yourself. it is kept in the config file, "
        + "and JOULE_CODE_SERVER overrides it for one shell.",
    },
  ];

  function routeNode(route) {
    const card = button("route route-" + route.route, "", () => post("route", { route: route.route }));
    card.appendChild(el("span", "route-title", route.title));
    card.appendChild(el("span", "route-why", route.why));
    return card;
  }

  function problemText(state) {
    if (state.binary && !state.binary.ok) { return state.binary.message; }
    if (state.state === "failed" && state.detail) {
      return "the configuration you have did not get a session started: " + state.detail;
    }
    return "";
  }

  function problemNode(state) {
    const box = el("div", "first-run-problem");
    box.appendChild(el("pre", "problem-text", problemText(state)));
    const help = state.binary && !state.binary.ok ? state.binary.helpLabel : "";
    if (help) {
      box.appendChild(button("link", help.toLowerCase(), () => post("help")));
    }
    return box;
  }

  function usable(state) {
    return !(state.binary && !state.binary.ok);
  }

  function node(state) {
    const box = el("div", "first-run");
    box.appendChild(wordmark(state.binary && state.binary.ok ? state.binary.version : ""));
    box.appendChild(el("p", "first-run-lead", LEAD));
    if (problemText(state) !== "") { box.appendChild(problemNode(state)); }
    if (usable(state)) {
      box.appendChild(el("p", "first-run-ask", ASK));
      const routes = el("div", "routes");
      for (const route of ROUTES) { routes.appendChild(routeNode(route)); }
      box.appendChild(routes);
    }
    if (state.note) { box.appendChild(el("p", "first-run-note", state.note)); }
    box.appendChild(button("link first-run-again", "done that? check again", () => post("recheck")));
    return box;
  }

  return { node, ROUTES, LEAD };
})();
