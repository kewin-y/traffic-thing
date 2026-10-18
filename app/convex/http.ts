import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { generateUploadUrl, publish } from "./networks/httpActions";

import { claim, complete } from "./simulations/httpActions";

const http = httpRouter();
http.route({ path: "/simulations/claim", method: "POST", handler: claim });
http.route({
  path: "/simulations/complete",
  method: "POST",
  handler: complete,
});

auth.addHttpRoutes(http);

http.route({
  path: "/networks/upload-url",
  method: "POST",
  handler: generateUploadUrl,
});

http.route({
  path: "/networks/publish",
  method: "POST",
  handler: publish,
});

export default http;
