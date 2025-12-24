import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Trash2, Copy, RotateCcw, StopCircle, Check } from 'lucide-react';
import { FileUpload } from './components/FileUpload';
import { FileList } from './components/FileList';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

// Safe Markdown component wrapper
const SafeMarkdown: React.FC<{ children: string }> = ({ children }) => {
    return <ReactMarkdown>{children}</ReactMarkdown>;
};

interface Message {
    role: 'user' | 'assistant';
    content: string;
    id: string;
}

// Sanitize LLM response by removing <think> and <think> tags and other problematic content
const sanitizeResponse = (text: string): string => {
    if (!text || typeof text !== 'string') return '';
    
    let sanitized = text;
    
    // Remove <think>...</think> blocks (chain-of-thought reasoning)
    sanitized = sanitized.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '');
    
    // Remove <think>...</think> blocks (standard think tags)
    sanitized = sanitized.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Remove any remaining unclosed tags (greedy match to end of string)
    sanitized = sanitized.replace(/<think>[\s\S]*$/gi, '');
    sanitized = sanitized.replace(/<think>[\s\S]*$/gi, '');
    
    // Remove ALL HTML-like tags as a safety measure (we'll use markdown only)
    // This is more aggressive but safer
    sanitized = sanitized.replace(/<[^>]+>/g, '');
    
    // Clean up any double newlines
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    
    return sanitized.trim();
};

function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleUploadSuccess = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    const handleSubmit = async (e?: React.FormEvent, retryMessage?: string) => {
        e?.preventDefault();
        const messageToSend = retryMessage || input.trim();
        if (!messageToSend || isLoading) return;

        const userMessage = messageToSend;
        const messageId = Date.now().toString();
        setInput('');

        // Remove the last assistant message if retrying
        if (retryMessage) {
            setMessages(prev => {
                const filtered = prev.filter((_, idx) => {
                    // Remove last assistant message if it exists
                    if (idx === prev.length - 1 && prev[idx].role === 'assistant') {
                        return false;
                    }
                    return true;
                });
                return [...filtered, { role: 'user', content: userMessage, id: messageId }];
            });
        } else {
            setMessages(prev => [...prev, { role: 'user', content: userMessage, id: messageId }]);
        }

        setIsLoading(true);

        // Create abort controller for stop functionality
        const controller = new AbortController();
        setAbortController(controller);

        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            console.log('Sending chat request to:', `${API_URL}/chat`);

            const response = await fetch(`${API_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage }),
                signal: controller.signal,
            });

            console.log('Response status:', response.status, response.statusText);

            if (!response.ok) {
                let errorDetail = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorDetail = errorData.detail || errorData.message || errorDetail;
                } catch (e) {
                    console.warn('Could not parse error response as JSON');
                }
                throw new Error(errorDetail);
            }

            const data = await response.json();
            console.log('Received data:', data);

            const rawResponse = data.response || data.message || data.detail || data.error;

            if (rawResponse === undefined || rawResponse === null || (typeof rawResponse === 'string' && rawResponse.trim() === '')) {
                console.warn('Received empty response text from server');
                throw new Error('The server returned an empty response.');
            }

            // Sanitize the response to remove <think> tags and other problematic content
            const responseText = sanitizeResponse(String(rawResponse));
            console.log('Sanitized response:', responseText.substring(0, 200) + '...');

            if (!responseText) {
                throw new Error('The response was empty after processing.');
            }

            const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            setMessages(prev => [...prev, { role: 'assistant', content: responseText, id: assistantMessageId }]);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Chat request aborted');
                setMessages(prev => [...prev, { role: 'assistant', content: 'Generation stopped.', id: (Date.now() + 1).toString() }]);
            } else {
                console.error('Chat error details:', error);
                const errorMessage = error.message || 'Sorry, I encountered an error. Please check the console for details.';
                setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}`, id: (Date.now() + 1).toString() }]);
            }
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    };

    const handleRetry = async (messageId: string) => {
        const messageIndex = messages.findIndex(msg => msg.id === messageId);
        if (messageIndex === -1 || messages[messageIndex].role !== 'assistant') return;

        // Find the user message before this assistant message
        let userMessageIndex = messageIndex - 1;
        while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
            userMessageIndex--;
        }

        if (userMessageIndex >= 0) {
            const userMessage = messages[userMessageIndex].content;
            // Remove the assistant message and re-submit
            setMessages(prev => prev.slice(0, messageIndex));
            await handleSubmit(undefined, userMessage);
        }
    };

    const handleStop = () => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
            setIsLoading(false);
        }
    };

    const copyToClipboard = async (text: string, messageId: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedId(messageId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the knowledge base? This will delete all uploaded files and the index.')) return;
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            await fetch(`${API_URL}/reset`, { method: 'DELETE' });
            setMessages([]);
            setRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error(error);
            alert('Failed to clear knowledge base');
        }
    };

    return (
        <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden font-sans">
            {/* Left Sidebar - File Management */}
            <div className="w-[350px] bg-gray-900 border-r border-gray-800 flex flex-col shadow-xl">
                <div className="p-6 border-b border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800/50">
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                        DocuChat
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">Chat with your documents</p>
                </div>

                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="p-6 flex-shrink-0">
                        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">Upload Documents</h2>
                        <FileUpload onUploadSuccess={handleUploadSuccess} />
                    </div>

                    <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
                        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">Uploaded Files</h2>
                        <FileList refreshTrigger={refreshTrigger} />
                    </div>
                </div>

                <div className="p-4 border-t border-gray-800 bg-gray-900/50">
                    <button
                        onClick={handleClear}
                        className="flex items-center justify-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors w-full px-4 py-3 rounded-lg hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40"
                    >
                        <Trash2 className="w-4 h-4" />
                        Clear Knowledge Base
                    </button>
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col relative bg-gray-950">
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-6 opacity-50">
                            <div className="w-20 h-20 rounded-2xl bg-gray-800 flex items-center justify-center shadow-lg">
                                <Bot className="w-10 h-10 text-gray-400" />
                            </div>
                            <div className="text-center space-y-2">
                                <p className="text-lg font-medium text-gray-300">Welcome to DocuChat</p>
                                <p className="text-sm max-w-md mx-auto">Upload documents from the sidebar and start asking questions. I'll use the context from your files to answer.</p>
                            </div>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={clsx(
                                "flex gap-4 max-w-4xl mx-auto group",
                                msg.role === 'user' ? "justify-end" : "justify-start"
                            )}
                        >
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20 mt-1">
                                    <Bot className="w-5 h-5 text-white" />
                                </div>
                            )}

                            <div className={clsx(
                                "relative px-5 py-4 rounded-2xl max-w-[85%] shadow-sm",
                                msg.role === 'user'
                                    ? "bg-blue-600 text-white rounded-tr-sm"
                                    : "bg-gray-800/90 border border-gray-700/50 text-gray-100 rounded-tl-sm"
                            )}>
                                <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
                                    {msg.role === 'user' ? (
                                        <p className="whitespace-pre-wrap">{msg.content}</p>
                                    ) : (
                                        <div className="prose-invert prose-sm">
                                            {typeof msg.content === 'string' ? (
                                                <SafeMarkdown>{msg.content}</SafeMarkdown>
                                            ) : (
                                                <p>{String(msg.content)}</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Message Actions - Always visible for assistant messages */}
                                {msg.role === 'assistant' && (
                                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-700/50">
                                        <button
                                            onClick={() => copyToClipboard(msg.content, msg.id)}
                                            className={clsx(
                                                "flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 rounded-md transition-colors",
                                                copiedId === msg.id && "text-green-400"
                                            )}
                                            title="Copy"
                                        >
                                            {copiedId === msg.id ? (
                                                <>
                                                    <Check className="w-3.5 h-3.5" />
                                                    <span>Copied</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-3.5 h-3.5" />
                                                    <span>Copy</span>
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => handleRetry(msg.id)}
                                            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 rounded-md transition-colors"
                                            title="Regenerate"
                                            disabled={isLoading}
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            <span>Regenerate</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {msg.role === 'user' && (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center shrink-0 mt-1 shadow-md">
                                    <User className="w-5 h-5 text-gray-200" />
                                </div>
                            )}
                        </div>
                    ))}

                    {isLoading && (
                        <div className="flex gap-4 max-w-4xl mx-auto">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div className="bg-gray-800/90 border border-gray-700/50 px-5 py-4 rounded-2xl rounded-tl-sm flex items-center gap-2">
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Chat Input Area */}
                <div className="p-4 md:p-6 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent border-t border-gray-800/50">
                    <div className="max-w-4xl mx-auto relative">
                        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="relative group">
                            <div className="relative flex items-end gap-2 bg-gray-900 border border-gray-700 rounded-2xl shadow-lg shadow-black/20 focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500/50 transition-all">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Ask a question about your documents..."
                                    className="flex-1 bg-transparent px-6 py-4 focus:outline-none placeholder:text-gray-500 text-gray-100"
                                    disabled={isLoading}
                                />
                                <div className="flex items-center gap-1 pr-2 pb-2">
                                    {isLoading ? (
                                        <button
                                            type="button"
                                            onClick={handleStop}
                                            className="p-2.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                                            title="Stop generation"
                                        >
                                            <StopCircle className="w-5 h-5" />
                                        </button>
                                    ) : (
                                        <button
                                            type="submit"
                                            disabled={!input.trim()}
                                            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-600/20"
                                            title="Send message"
                                        >
                                            <Send className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </form>
                        <p className="text-center text-xs text-gray-600 mt-3">
                            AI can make mistakes. Please verify important information.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;