# Third-party notices

## Google Photos Toolkit

The RPC identifiers, argument shapes and response index paths in
`src/config/default-config.ts` and `src/adapter/google/` were informed by the
reverse-engineering work in Google Photos Toolkit
(https://github.com/xob0t/Google-Photos-Toolkit), MIT licensed. No source code
was copied; the protocol facts were re-implemented. Retain this notice.

## Models

Embedding models are downloaded at runtime from the Hugging Face Hub and are
not redistributed in this package. Each model keeps its own license; check it
before making a model the shipped default:

- DINOv2 (Meta): Apache-2.0
- DINOv3 (Meta): DINOv3 License (custom). Review terms before commercial use.
- MobileCLIP (Apple): check the model card license.

## Runtime libraries

- @huggingface/transformers: Apache-2.0
- onnxruntime-web: MIT
- idb: ISC
- React: MIT
