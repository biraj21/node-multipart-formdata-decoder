import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const server = http.createServer((req, res) => {
  const { method, url } = req;

  if (method === "GET" && (url === "/" || url === "/index.html")) {
    fs.createReadStream("index.html").pipe(res);
    return;
  }

  if (method === "POST" && url === "/upload") {
    // make sure it's multipart/form-data
    if (!req.headers["content-type"].startsWith("multipart/form-data;")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "content-type should be multipart/form-data" }));
      return;
    }

    // get the boundary
    const boundaryPart = req.headers["content-type"].split(";")[1]?.trim();
    let boundary;
    if (typeof boundaryPart === "string" && boundaryPart.startsWith("boundary=")) {
      boundary = boundaryPart.slice("boundary=".length).trim();
    }

    if (!boundary) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "content-type: boundary is required" }));
      return;
    }

    const chunks = [];
    req
      .on("data", (chunk) => {
        chunks.push(chunk);
      })
      .on("end", async () => {
        const buffer = Buffer.concat(chunks);

        const body = await parseMultipartData(buffer, boundary);
        console.log(body);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "file uploaded" }));
      });

    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ message: "not found" }));
});

const PORT = 3000;
server.listen(PORT, () => console.log(`server running on port ${PORT}...`));

const PART_HEADER_REGEX =
  /Content-Disposition: form-data; name="([a-zA-Z0-9]+)"(?:(?:; filename="([a-zA-Z0-9. _\-]+)")?\r?\n(?:Content-Type: ([a-z\/]+))?)?/;

/**
 *
 * @param {string} partHeader
 */
function parsePartHeader(partHeader) {
  const result = {};
  const groups = partHeader.match(PART_HEADER_REGEX)?.slice(1) || [];

  if (groups[0]) {
    result.name = groups[0];
  }

  if (groups[1]) {
    result.file = {
      filename: groups[1],
    };
  }

  if (groups[2]) {
    result.file["content-type"] = groups[2];
  }

  return result;
}

/**
 *
 * @param {Buffer} buffer
 * @param {string} boundary
 */
async function parseMultipartData(buffer, boundary) {
  // Find the boundary in the buffer
  const boundaryIndex = buffer.indexOf(boundary);

  // Split the buffer into parts using the boundary
  const parts = buffer
    .subarray(boundaryIndex + boundary.length + 2)
    .toString()
    .split(boundary);

  const body = {
    files: [],
  };

  const fileWritePromises = [];

  parts.forEach((part) => {
    // it ends with 2 CRLF
    const partHeaderEnd = part.indexOf("\r\n\r\n");
    const partHeader = part.slice(0, partHeaderEnd).toString();

    const { name, file } = parsePartHeader(partHeader);

    const partBody = part.slice(partHeaderEnd + 4, part.lastIndexOf("\r\n"));

    if (file?.filename) {
      const filename = file.filename;
      const filePath = path.join("storage", filename);

      const fwp = fs.promises.writeFile(filePath, partBody);
      fwp.then(() => {
        body.files.push({
          name,
          filename,
          "content-type": file["content-type"],
          filePath,
        });
      });

      fileWritePromises.push(fwp);
    } else if (name) {
      body[name] = partBody;
    }
  });

  await Promise.all(fileWritePromises);

  return body;
}
