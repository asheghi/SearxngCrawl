import express, { Request, Response } from 'express';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 3000;

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://search.fikacloud.se';
const CRAWLER_URL = process.env.CRAWLER_URL || 'https://crawler.fikacloud.se';

interface SearchResult {
    url: string;
    title?: string;
    content?: string;
}

interface CrawlResult {
    url: string;
    markdown: string;
}

interface CrawlTaskResponse {
    task_id: string;
}

interface TaskStatusResponse {
    status: 'completed' | 'failed' | 'pending' | 'processing';
    results: CrawlResult[];
}

/**
 * Main Search Endpoint
 * Usage: GET /search?q=your+query
 */
app.get('/search', async (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).send("Missing query parameter 'q'");

    console.log(`[Search] Received query: "${query}"`);

    try {
        // 1. DISCOVER: Get top URLs from SearXNG
        console.log(`[Search] Fetching results from SearXNG: ${SEARXNG_URL}`);
        const searchResponse = await axios.get(`${SEARXNG_URL}/search`, {
            params: { q: query, format: 'json' }
        });
        
        const results: SearchResult[] = searchResponse.data.results || [];
        const urls = results.slice(0, 3).map(r => r.url);

        if (urls.length === 0) {
            console.log(`[Search] No results found for: "${query}"`);
            return res.send("# No results found\nTry a different query.");
        }

        console.log(`[Search] Found ${urls.length} URLs to crawl:`, urls);

        // 2. CRAWL: Submit batch to Crawl4AI
        console.log(`[Crawl] Submitting task to Crawl4AI: ${CRAWLER_URL}`);
        const crawlSubmission = await axios.post<CrawlTaskResponse>(`${CRAWLER_URL}/crawl`, {
            urls: urls,
            browser_config: { headless: true, text_mode: true },
            run_config: {
                markdown_generator: {
                    type: "DefaultMarkdownGenerator",
                    params: { 
                        content_filter: { 
                            type: "PruningContentFilter",
                            params: { threshold: 0.48, min_word_threshold: 40 } 
                        }
                    }
                },
                excluded_tags: ["nav", "footer", "header"],
                wait_until: "domcontentloaded"
            }
        });

        res.json(((crawlSubmission.data as any)?.results || []).map((result: any) => ({
            url: result?.url,
            title: result?.metadata?.title,
            links: result?.links,
            description: result?.metadata?.description,
            markdown: result?.markdown?.raw_markdown
        })));

    } catch (error: any) {
        console.error(`[Error] ${error.message}`);
        res.status(500).send(`## Error\n${error.message}`);
    }
});

app.listen(port, () => console.log(`Perplexity-Lite running on http://localhost:${port}`));
