# Paillette

AI-powered multimodal search and management platform for art galleries worldwide, starting with the National Gallery Singapore.

## Overview

Paillette enables galleries to manage, search, and discover artworks through advanced AI capabilities including image embeddings, multimodal search, automatic metadata management, and multi-language translation.

## Core Features

### 1. Image Collection & Embedding Generation
- Upload collections of artwork images
- Automatic embedding generation for semantic search
- Enable visual similarity search across entire collections

### 2. Metadata Management
- Upload and associate metadata via CSV
- Edit individual artwork entries (image + metadata)
- Manage collections with minimal existing metadata

### 3. Multimodal Search
- **Text search**: Search using natural language queries via embeddings
- **Image search**: Upload an image to find visually similar artworks
- **Color search**: Find artworks by color palette
- **Metadata filters**: Filter by any metadata column

### 4. Artwork Viewing & Management
- Grid view with citation copy functionality
- Detailed artwork view with full metadata
- Filter and sort by metadata columns
- Click to view enlarged images and details

### 5. Embedding Projector
- Visualize artwork collections in embedding space
- Similar artworks cluster together
- Interactive exploration of visual relationships

### 6. Image Processing
- Automatic picture frame removal
- Extract clean artwork from photographed images
- Add metadata to processed images

### 7. Multi-Language Translation
- Instant translation of text/documents
- Support for EN, Chinese, Tamil, Malay
- Multiple provider integration for best quality
- Download as single or multiple documents

### 8. API Access
- RESTful APIs for all core functionality
- Proper authentication and authorization
- Comprehensive API documentation
- Easy integration with gallery systems

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: FastAPI + Python
- **AI/ML**: Image embeddings, computer vision, NLP
- **Database**: Vector database for embeddings + metadata storage
- **Translation**: Multi-provider translation APIs
- **Image Processing**: Frame detection and removal

## Getting Started

Documentation and setup instructions will be added as development progresses.

## Development

This project follows Test-Driven Development (TDD) practices with high test coverage targets (95%+).

## License

To be determined
