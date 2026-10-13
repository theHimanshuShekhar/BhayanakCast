import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Start's own settings: loaded by the server and the browser. Having this file replaces the
// request middleware Start applies when there is none, which is the CSRF check on server
// functions, so it is added back here exactly as Start's warning shows it.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Every server function that throws is written to the log with the function's name, the route and
// the user (src/server/request-errors.ts). Start answers a throwing server function itself, with
// a serialised error, so nothing further out ever sees it: this is the only place to. A call that
// succeeds writes nothing. Routes and pages that throw are logged by srvx's security-headers
// middleware (src/server/security-headers.ts).
const logServerFnErrors = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    try {
      return await next();
    } catch (error) {
      const { logServerFnError } = await import("./server/request-errors");
      logServerFnError(error, { name: serverFnMeta.name });
      throw error;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [logServerFnErrors],
}));
