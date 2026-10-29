import { handle, type Request } from "./worker";

self.onmessage = (e: MessageEvent<Request>) => {
  const response = handle(e.data);
  if (response) self.postMessage(response);
};
