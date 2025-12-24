import os
import shutil
from typing import List, Optional
from fastapi import UploadFile
import logging

from llama_index.core import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    StorageContext,
    Settings,
    load_index_from_storage,
)
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.openai import OpenAI
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
import chromadb

logger = logging.getLogger(__name__)

# Try to import Gemini - handle different possible import paths
try:
    from llama_index.llms.gemini import Gemini
except ImportError:
    try:
        from llama_index.llms.google import Gemini
    except ImportError:
        Gemini = None
        logger.warning("Gemini LLM not available. Install llama-index-llms-gemini package.")

# Configuration
CHROMA_DB_DIR = "./data/chroma_db"
UPLOAD_DIR = "./data/uploads"

# LLM Provider Configuration
# Options: "lm_studio", "ollama", "openai", or "gemini"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "lm_studio").lower()

# LM Studio Configuration
LM_STUDIO_API_BASE = os.getenv("LM_STUDIO_API_BASE", "http://host.docker.internal:1234/v1")
LM_STUDIO_API_KEY = os.getenv("LM_STUDIO_API_KEY", "lm-studio")
# Use a valid OpenAI model name that LM Studio supports (e.g., gpt-3.5-turbo, gpt-4)
# LM Studio will use whatever model you have loaded, regardless of this name
LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "gpt-3.5-turbo")

# Ollama Configuration
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama2")  # Common models: llama2, mistral, codellama, etc.

# OpenAI Configuration (for official OpenAI API)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")  # Options: gpt-3.5-turbo, gpt-4, gpt-4-turbo-preview, etc.

# Gemini Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# Valid model names: models/gemini-2.5-flash, models/gemini-2.5-pro, models/gemini-2.0-flash
# Models require the "models/" prefix
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "models/gemini-2.5-flash")

# Ensure directories exist
os.makedirs(CHROMA_DB_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

class RagEngine:
    def __init__(self):
        self.llm_initialized = False
        self._initialize_settings()
        self.index = self._initialize_index()

    def _initialize_settings(self):
        # Configure LLM based on provider
        if LLM_PROVIDER == "ollama":
            Settings.llm = Ollama(
                model=OLLAMA_MODEL,
                base_url=OLLAMA_BASE_URL,
                temperature=0.7,
                request_timeout=120.0,  # Ollama can be slower for large models
            )
            logger.info(f"Initialized Ollama LLM with model: {OLLAMA_MODEL} at {OLLAMA_BASE_URL}")
        elif LLM_PROVIDER == "openai":
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY environment variable is required when using OpenAI provider")
            Settings.llm = OpenAI(
                api_key=OPENAI_API_KEY,
                model=OPENAI_MODEL,
                temperature=0.7,
            )
            logger.info(f"Initialized OpenAI LLM with model: {OPENAI_MODEL}")
        elif LLM_PROVIDER == "gemini":
            self._initialize_gemini()
        elif LLM_PROVIDER == "lm_studio":
            # Configure LLM (LM Studio)
            # Note: The model name here must be a valid OpenAI model name for validation
            # LM Studio will use whatever model you have loaded in the app, regardless of this name
            Settings.llm = OpenAI(
                api_base=LM_STUDIO_API_BASE,
                api_key=LM_STUDIO_API_KEY,
                model=LM_STUDIO_MODEL,
                temperature=0.7,
            )
            logger.info(f"Initialized LM Studio LLM with model: {LM_STUDIO_MODEL} at {LM_STUDIO_API_BASE}")
        else:  # Default to LM Studio
            # Configure LLM (LM Studio)
            # Note: The model name here must be a valid OpenAI model name for validation
            # LM Studio will use whatever model you have loaded in the app, regardless of this name
            Settings.llm = OpenAI(
                api_base=LM_STUDIO_API_BASE,
                api_key=LM_STUDIO_API_KEY,
                model=LM_STUDIO_MODEL,
                temperature=0.7,
            )
            logger.info(f"Initialized LM Studio LLM with model: {LM_STUDIO_MODEL} at {LM_STUDIO_API_BASE}")
        
        # Configure Embeddings (Local HuggingFace)
        # Using a small, fast model
        Settings.embed_model = HuggingFaceEmbedding(
            model_name="BAAI/bge-small-en-v1.5"
        )
    
    def _initialize_gemini(self):
        """Initialize Gemini LLM."""
        if Gemini is None:
            raise ValueError("Gemini LLM is not available. Please install llama-index-llms-gemini package.")
        
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY environment variable is required when using Gemini provider")
        
        Settings.llm = Gemini(
            api_key=GEMINI_API_KEY,
            model_name=GEMINI_MODEL,
            temperature=0.7,
        )
        logger.info(f"Initialized Gemini LLM with model: {GEMINI_MODEL}")
        self.llm_initialized = True

    def _initialize_index(self) -> VectorStoreIndex:
        try:
            chroma_host = os.getenv("CHROMA_SERVER_HOST")
            chroma_port = os.getenv("CHROMA_SERVER_HTTP_PORT", "8000")

            if chroma_host:
                logger.info(f"Connecting to ChromaDB at {chroma_host}:{chroma_port}")
                db = chromadb.HttpClient(host=chroma_host, port=int(chroma_port))
            else:
                logger.info(f"Using embedded ChromaDB at {CHROMA_DB_DIR}")
                db = chromadb.PersistentClient(path=CHROMA_DB_DIR)

            chroma_collection = db.get_or_create_collection("docuchat")
            vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
            storage_context = StorageContext.from_defaults(vector_store=vector_store)

            index = VectorStoreIndex.from_vector_store(
                vector_store,
                storage_context=storage_context,
            )
            return index
        except Exception as e:
            logger.error(f"Error initializing index: {e}")
            # Fallback to embedded if remote fails
            logger.warning("Falling back to embedded ChromaDB")
            db = chromadb.PersistentClient(path=CHROMA_DB_DIR)
            chroma_collection = db.get_or_create_collection("docuchat")
            vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
            storage_context = StorageContext.from_defaults(vector_store=vector_store)
            return VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)

    async def ingest_document(self, file: UploadFile) -> str:
        try:
            # Save file temporarily
            file_path = os.path.join(UPLOAD_DIR, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            logger.info(f"Loading document: {file.filename}")
            # Load document
            reader = SimpleDirectoryReader(input_files=[file_path])
            documents = reader.load_data()
            logger.info(f"Loaded {len(documents)} document(s) from {file.filename}")
            
            if not documents:
                raise ValueError(f"No content extracted from {file.filename}")
            
            # Insert into index
            for i, doc in enumerate(documents):
                logger.info(f"Inserting document {i+1}/{len(documents)} (length: {len(doc.text)} chars)")
                self.index.insert(doc)
            
            # Persist is handled automatically by ChromaDB persistent client usually, 
            # but LlamaIndex might need explicit persist call if using docstore
            self.index.storage_context.persist(persist_dir=CHROMA_DB_DIR)
            
            # Verify insertion by checking index
            try:
                retriever = self.index.as_retriever(similarity_top_k=1)
                # Try a simple query to verify index works
                test_nodes = retriever.retrieve("test")
                logger.info(f"Index verification: {len(test_nodes)} nodes found in index")
            except Exception as e:
                logger.warning(f"Could not verify index: {e}")
            
            return f"Successfully ingested {file.filename}"
        except Exception as e:
            logger.error(f"Error ingesting document: {e}", exc_info=True)
            raise e

    async def chat(self, message: str) -> str:
        try:
            logger.info(f"Received chat message: {message[:100]}...")
            
            # Check if LLM is initialized and not MockLLM
            if Settings.llm is None:
                error_msg = f"LLM not initialized. Please check your {LLM_PROVIDER.upper()} configuration and API key."
                if LLM_PROVIDER == "gemini":
                    error_msg += " Common issues: Invalid API key, model not available in your region, or incorrect model name."
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Check if LLM is MockLLM (fallback when LLM initialization fails)
            from llama_index.core.llms.mock import MockLLM
            if isinstance(Settings.llm, MockLLM):
                error_msg = f"LLM initialization failed. Please check your {LLM_PROVIDER.upper()} configuration and API key."
                if LLM_PROVIDER == "gemini":
                    error_msg += " Common issues: Invalid API key, model not available in your region, or incorrect model name. Try switching to a different LLM provider (ollama, openai, or lm_studio)."
                elif LLM_PROVIDER == "openai":
                    error_msg += " Please verify your OPENAI_API_KEY is valid."
                elif LLM_PROVIDER == "ollama":
                    error_msg += " Please ensure Ollama is running and accessible at the configured base URL."
                elif LLM_PROVIDER == "lm_studio":
                    error_msg += " Please ensure LM Studio is running and accessible at the configured API base URL."
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Check if index has any documents
            if self.index is None:
                logger.error("Index not initialized")
                raise ValueError("Index not initialized. Please upload documents first.")
            
            # Check if index has any nodes/documents
            try:
                # Try to get a retriever to check if there are any documents
                retriever = self.index.as_retriever(similarity_top_k=5)
                # This will fail if there are no documents
                test_nodes = retriever.retrieve(message)
                logger.info(f"Retrieved {len(test_nodes)} nodes for query")
                
                if len(test_nodes) == 0:
                    logger.warning("No nodes retrieved - index might be empty")
                    return "I couldn't find any relevant information in your documents to answer this question. Please make sure you've uploaded the right documents."
                
                # Log the retrieved context for debugging
                for i, node in enumerate(test_nodes[:2]):  # Log first 2 nodes
                    logger.info(f"Node {i} preview: {str(node.text)[:200]}...")
            except Exception as e:
                logger.warning(f"Error checking index contents: {e}")
                # Continue anyway - might still work
            
            # Use query engine with better retrieval settings
            query_engine = self.index.as_query_engine(
                similarity_top_k=5,  # Retrieve top 5 similar chunks
                response_mode="compact",  # Use compact mode for better context usage
            )
            
            # Better system prompt that's less strict
            system_prompt = (
                "You are a helpful assistant that answers questions based on the provided context from documents. "
                "Use the context information to answer the user's question. "
                "If the context contains relevant information, use it to provide a detailed answer. "
                "If the context doesn't contain enough information, you can still provide a helpful response based on what you know, but mention that the information might not be in the documents."
            )
            
            # Create chat engine with better settings
            chat_engine = self.index.as_chat_engine(
                chat_mode="context",
                system_prompt=system_prompt,
                similarity_top_k=5,  # Retrieve more context
                verbose=True,
            )
            
            logger.info("Calling chat engine...")
            response = chat_engine.chat(message)
            
            if response is None:
                logger.error("Chat engine returned None")
                raise ValueError("Chat engine returned no response")
                
            response_str = str(response).strip()
            logger.info(f"Chat engine response received (length: {len(response_str)}): {response_str[:100]}...")
            
            if not response_str:
                logger.error("Chat engine returned an empty string")
                raise ValueError("Empty response from chat engine")
            
            # Check if response is just the prompt template (MockLLM behavior)
            # MockLLM returns the prompt template instead of generating a response
            if "system:" in response_str.lower() and "user:" in response_str.lower() and "assistant:" in response_str.lower():
                logger.warning("Response appears to be a prompt template (MockLLM detected) - trying query engine as fallback")
                # Try query engine as fallback
                try:
                    query_response = query_engine.query(message)
                    if query_response and str(query_response).strip() and str(query_response) != "Empty Response":
                        logger.info("Query engine found response")
                        return str(query_response).strip()
                except Exception as e:
                    logger.warning(f"Query engine also failed: {e}")
                
                raise ValueError("LLM is not properly initialized. The response contains only the prompt template. Please check your LLM configuration.")
            
            # Handle LlamaIndex default "Empty Response"
            if response_str == "Empty Response" or "couldn't find" in response_str.lower() or "no relevant information" in response_str.lower():
                logger.warning("Chat engine returned empty or no-info response - trying query engine as fallback")
                
                # Try query engine as fallback
                try:
                    query_response = query_engine.query(message)
                    if query_response and str(query_response).strip() and str(query_response) != "Empty Response":
                        logger.info("Query engine found response")
                        return str(query_response).strip()
                except Exception as e:
                    logger.warning(f"Query engine also failed: {e}")
                
                return "I couldn't find any relevant information in your documents to answer this question. Please make sure you've uploaded the right documents."
            
            return response_str
        except Exception as e:
            logger.error(f"Error in chat: {str(e)}", exc_info=True)
            raise e  # Re-raise to let API handle it properly

    def list_documents(self) -> List[str]:
        try:
            if not os.path.exists(UPLOAD_DIR):
                return []
            return [f for f in os.listdir(UPLOAD_DIR) if os.path.isfile(os.path.join(UPLOAD_DIR, f))]
        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return []
    
    def get_index_status(self) -> dict:
        """Get status of the index including document count"""
        try:
            status = {
                "index_initialized": self.index is not None,
                "uploaded_files": self.list_documents(),
                "index_has_content": False,
                "node_count": 0
            }
            
            if self.index is not None:
                try:
                    # Try to retrieve nodes to check if index has content
                    retriever = self.index.as_retriever(similarity_top_k=1)
                    test_nodes = retriever.retrieve("test query")
                    status["index_has_content"] = len(test_nodes) > 0
                    status["node_count"] = len(test_nodes) if test_nodes else 0
                except Exception as e:
                    logger.warning(f"Could not check index content: {e}")
                    status["error"] = str(e)
            
            return status
        except Exception as e:
            logger.error(f"Error getting index status: {e}")
            return {"error": str(e)}
    
    async def reindex_all_documents(self) -> str:
        """Re-index all existing documents in the upload directory"""
        try:
            files = self.list_documents()
            if not files:
                return "No documents to re-index"
            
            logger.info(f"Re-indexing {len(files)} documents")
            reindexed = []
            
            for filename in files:
                try:
                    file_path = os.path.join(UPLOAD_DIR, filename)
                    logger.info(f"Re-indexing: {filename}")
                    
                    # Load document
                    reader = SimpleDirectoryReader(input_files=[file_path])
                    documents = reader.load_data()
                    logger.info(f"Loaded {len(documents)} document(s) from {filename}")
                    
                    if not documents:
                        logger.warning(f"No content extracted from {filename}")
                        continue
                    
                    # Insert into index
                    for i, doc in enumerate(documents):
                        logger.info(f"Inserting document {i+1}/{len(documents)} from {filename} (length: {len(doc.text)} chars)")
                        self.index.insert(doc)
                    
                    reindexed.append(filename)
                except Exception as e:
                    logger.error(f"Error re-indexing {filename}: {e}", exc_info=True)
                    continue
            
            # Persist the index
            self.index.storage_context.persist(persist_dir=CHROMA_DB_DIR)
            
            return f"Successfully re-indexed {len(reindexed)}/{len(files)} documents: {', '.join(reindexed)}"
        except Exception as e:
            logger.error(f"Error re-indexing documents: {e}", exc_info=True)
            raise e

    def clear_index(self):
        try:
            # Re-initialize with empty
            shutil.rmtree(CHROMA_DB_DIR)
            os.makedirs(CHROMA_DB_DIR, exist_ok=True)
            # Also clear uploads
            if os.path.exists(UPLOAD_DIR):
                shutil.rmtree(UPLOAD_DIR)
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            
            self.index = self._initialize_index()
            return "Index cleared"
        except Exception as e:
            logger.error(f"Error clearing index: {e}")
            raise e

rag_engine = RagEngine()
