Setup:
1. An environment variable, EXTERNAL_API_KEY, is required. An API key can be obtained for free at https://ocr.space
You can make a .env file which dotenv will pull in or you create env vars yourself on your system:
PORT=3000
EXTERNAL_API_KEY=yourapikeyhere
2. Install the dependencies via: npm install express multer axios form-data dotenv (or: npm install (if you want to use package.json))
4. Use node to start: node server.js
5. open browser to localhost (or whatever port you decided but 80 is the default)

Ideas for improvement:
1. It makes way more sense to read the image and then auto populate the fields and ask the user to verify instead of having the user enter everything and then verify. This introduces additional steps, but it's much more user friendly; nobody likes having to fill out forms.
2. Right now OCREngine 2 is being used because OCREngine 1 was unable to detect text properly, however it can take considerably longer. It may be better to use engine 1 first and automatically use engine 2 if text is unable to be found.
3. Even if OCR works great, there should always be an easy way to QA results or resolve issues found by the end-user. There should be a database of images uploaded with their results so a human can verify and possibly use the data to train a future model.
4. The external API is called with every submission. If the user just modified text in the field, then there is no need to call the API over again.
5. The image and text results should be displayed to the user, like Google Lens.
6. Can add fuzzy matching in case OCR misreads characters.
7. Checks label with information given by user but doesn't infer things like the label name. For example, error message says text cannot be found rather than "Brand name detected as Old Tom's but user entered Old Jim's."
8. Given more time, I'd implement stricter and specific checks given on TTB website. I'd also use the bounding boxes to mark and show user specific discrepancies. Additionally, of course there would be a way to contest or request human review in cases of failure.

Notes:
1. Using the Free tier of OCR.space sometimes times out or takes up to a minute to process and other times it takes less than a second.
2. Handles only the following formats: GIF, PNG, JPG, TIF, BMP limited to 1MB in size.

Reasoning:
1. Multiple times, the requirements hint at keeping the product simple while also having optional fields. Some of these seem to contradict, therefore I focused on the MVP and ignored optional tasks. The government warning was said to be optional but later expected--I treated as optional, following the instructions closer to the top.
2. Using external service for OCR keeps code base simple and easier to maintain. Hosting for own OCR would be required as well, having to manage compute costs. ocr.space handles everything for an exceptionally low price as compared to Google. Based on data from TTB, if there are 150k label approvals per year, then 300k calls to the API per MONTH should be more than enough to handle the traffic. TTB website suggests less than 200k traffic per year (https://www.ttb.gov/regulated-commodities/labeling/processing-times). The service is affordable, fast, reliable, simple, and accurate.
Considered and explored multiple OCR solutions Tesseract, PaddleOCR, Google Vision, Mistral OCR, Free OCR, Puter.js...Free OCR at OCR Space seemed to be the best solution.
3. Uses regex to match pattern for alcohol content. Starts at a new word, and ensures some suffix comes after the number while ignoring spaces. abv, percent, or % is allowed. Numbers could appear anywhere on the label, so need to make sure this number is associated with the abv.
4. Initially, looked at using OpenSource PaddleOCR, however it was controlled by Chinese company and introduces risk, specifically with dependencies and docker images hosted on Chinese servers. It's an unnecessary vector of risk but could be mitigated with security scans and pulling from GitHub but requires close watch on packages during build process. When tested on local machine, processing time and accuracy were unfit for usage.
5. PyTesseract is old and was unable to detect the alcohol content with an example image found on the TTB website. Required a series of color manipulation and upscaling to read labels, which could greatly misrepresent the original label (if a human has difficulty seeing it but an AI can see it easily, then the purpose of the label is moot).

6. Even though in the code we know the exact shape of the response json or that the frontend is checking if a file has been selected or that the filetype uploaded is restricted, we still check these on the backend for defensive coding. APIs could change, frontend could change, someone could bypass the frontend. Plus it doesn't add a whole lot of bloat.
