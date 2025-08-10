FROM node:18-bookworm

# Create app directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Set environment variables (Cloud Run can override these)
ENV PORT=8080 \
    PROJECT_ID=fleet-parsec-468019-b8 \
    LOCATION=us-central1 \
    EMBEDDING_MODEL=text-embedding-004 \
    GENERATION_MODEL=gemini-1.5-flash-001 \
    TOP_K=3 \
    CHAT_LIMIT=2

EXPOSE 8080

# Start the backend
CMD ["npm", "start"]
