from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from app.rag_engine import rag_engine

router = APIRouter()

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        result = await rag_engine.ingest_document(file)
        return {"message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/files")
async def list_files():
    try:
        files = rag_engine.list_documents()
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    import logging
    logger = logging.getLogger(__name__)
    try:
        logger.info(f"Chat request received: {request.message[:50]}...")
        if not request.message or not request.message.strip():
            logger.warning("Empty message received")
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        
        response = await rag_engine.chat(request.message)
        
        if not response or not response.strip():
            logger.error("Empty response from rag_engine.chat")
            raise HTTPException(status_code=500, detail="Empty response from chat engine")
        
        logger.info(f"Sending chat response (length: {len(response)})")
        return {"response": response}
    except HTTPException as e:
        logger.warning(f"HTTP error in chat: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error in chat endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

@router.delete("/reset")
async def reset_index():
    try:
        result = rag_engine.clear_index()
        return {"message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_status():
    """Get index status for debugging"""
    try:
        status = rag_engine.get_index_status()
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reindex")
async def reindex_documents():
    """Re-index all existing documents"""
    try:
        result = await rag_engine.reindex_all_documents()
        return {"message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
