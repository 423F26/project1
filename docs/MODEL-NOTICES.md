# Local analysis model notices

## ProsusAI FinBERT

Model: [`ProsusAI/finbert`](https://huggingface.co/ProsusAI/finbert), by Prosus AI; see the FinBERT paper, [*FinBERT: Financial Sentiment Analysis with Pre-trained Language Models*](https://arxiv.org/abs/1908.10063).

The model card identifies the weights as **CC BY-NC-SA 4.0**. Use is limited to non-commercial purposes; adaptations must follow the same license. The project uses the unmodified checkpoint for positive/negative/neutral sentiment classification. This notice and the license terms are included in the worker image at `/app/MODEL-NOTICES.md`.

License: [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/).

## Helsinki-NLP German-to-English translation

Model: [`Helsinki-NLP/opus-mt-de-en`](https://huggingface.co/Helsinki-NLP/opus-mt-de-en), from the OPUS-MT project.

The model card lists the **Apache License 2.0**. It is used locally to translate German passages before sentiment classification. Original German passage text is retained with its translation.

License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Local report model and viewer

- **Qwen/Qwen3-4B-Instruct-2507**, Alibaba Qwen team, Apache-2.0. [Model and license](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507). Source revision: `cdbee75f17c01a7cc42f958dc650907174af0554`. Converted locally to GGUF **Q4_K_M**; the build saves the resulting SHA-256 in `/opt/report-model/SHA256SUMS`. Quantization and CPU performance require evaluation on the deployment hardware. No model-quality claim follows from its installation.
- **llama.cpp**, ggml contributors, MIT. [Source and license](https://github.com/ggml-org/llama.cpp). Runtime revision: `5851a8e505f4d5fbb183f2847698eb6155d176b7`. The runtime is loopback-only, with no exposed model-service port or hosted inference provider.
- **PDF.js**, Mozilla contributors, Apache-2.0; distributed through the pinned `pdfjs-dist` package. [Source and license](https://github.com/mozilla/pdf.js). Its modules and worker are served locally.
- **sanitize-html**, Apostrophe Technologies and contributors, MIT. [Source and license](https://github.com/apostrophecms/sanitize-html). Used to isolate original HTML documents; source scripts and requests are prohibited independently by sandbox/CSP.

Preserve the packages' included license notices when distributing images. Existing FinBERT non-commercial restrictions still apply to the sentiment feature. Qwen-generated reports are experimental partial reviews, not calibrated bias measurements or investment advice.
