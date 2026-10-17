import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { generateUploadUrl, publish } from "./networks/httpActions";

const http = httpRouter();

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
