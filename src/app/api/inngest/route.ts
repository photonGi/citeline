import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { crawlSource } from "@/lib/inngest/functions/crawl-source";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [crawlSource],
});
