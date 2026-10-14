import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/*
  Cloudflare Workers build (OpenNext). No R2 incremental cache: every page is
  rendered on request and the read cache is keyed on the data version, so there
  is nothing worth persisting between instances that would justify a bucket.
*/
export default defineCloudflareConfig({});
