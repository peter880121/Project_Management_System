# Vector adapter

Business modules call this adapter, never the Milvus SDK directly. Use a `documents` collection with project filtering; writes must be retryable and searches must degrade to MySQL keyword search.
