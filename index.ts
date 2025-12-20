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

    try {
        // 1. DISCOVER: Get top URLs from SearXNG
        const searchResponse = await axios.get(`${SEARXNG_URL}/search`, {
            params: { q: query, format: 'json' }
        });
        
        const results: SearchResult[] = searchResponse.data.results || [];
        const urls = results.slice(0, 3).map(r => r.url);

        if (urls.length === 0) return res.send("# No results found\nTry a different query.");

        // 2. CRAWL: Submit batch to Crawl4AI
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

        const taskId = crawlSubmission.data.task_id;

        // 3. POLL: Wait internally for completion
        let finalMarkdown = `# Search Results for: ${query}\n\n`;
        let completed = false;
        
        while (!completed) {
            await new Promise(r => setTimeout(r, 1500)); // Check every 1.5s
            const taskStatus = await axios.get<TaskStatusResponse>(`${CRAWLER_URL}/task/${taskId}`);
            
            if (taskStatus.data.status === 'completed') {
                taskStatus.data.results.forEach((result, index) => {
                    finalMarkdown += `## [${index + 1}] Source: ${result.url}\n\n${result.markdown}\n\n---\n\n`;
                });
                completed = true;
            } else if (taskStatus.data.status === 'failed') {
                throw new Error("Crawl4AI failed to process the request.");
            }
        }

        // 4. RESPOND: Return the combined Markdown
        res.setHeader('Content-Type', 'text/markdown');
        res.send(finalMarkdown);

    } catch (error: any) {
        console.error(error);
        res.status(500).send(`## Error\n${error.message}`);
    }
});

app.listen(port, () => console.log(`Perplexity-Lite running on http://localhost:${port}`));
