import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { generateUploadUrl } from "./networks/httpActions";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/networks/upload-url",
  method: "POST",
  handler: generateUploadUrl,
});

export default http;
