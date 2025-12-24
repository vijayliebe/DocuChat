import React, { useState, useRef } from 'react';
import { Check, AlertCircle, Loader2, FileUp } from 'lucide-react';
import clsx from 'clsx';
// import { motion } from 'framer-motion';

interface FileUploadProps {
    onUploadSuccess: () => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setIsUploading(true);
        setStatus('idle');
        setMessage('');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            const response = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Upload failed');

            await response.json();
            setStatus('success');
            setMessage('File uploaded successfully');
            onUploadSuccess();

            // Clear success message after 3 seconds
            setTimeout(() => {
                setStatus('idle');
                setMessage('');
            }, 3000);

        } catch (error) {
            setStatus('error');
            setMessage('Failed to upload file');
            console.error(error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = ''; // Reset
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    return (
        <div>
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={clsx(
                    "relative group cursor-pointer border-2 border-dashed rounded-xl p-8 transition-all duration-200 ease-in-out text-center",
                    isDragging
                        ? "border-blue-500 bg-blue-500/10 scale-[1.02]"
                        : "border-gray-700 hover:border-blue-500/50 hover:bg-gray-800/30",
                    isUploading && "opacity-50 cursor-not-allowed pointer-events-none"
                )}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleChange}
                    className="hidden"
                    disabled={isUploading}
                    accept=".pdf,.docx,.txt"
                />

                <div className="flex flex-col items-center gap-3">
                    {isUploading ? (
                        <>
                            <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
                            <p className="text-sm font-medium text-blue-400">Processing document...</p>
                        </>
                    ) : (
                        <>
                            <div className={clsx(
                                "p-4 rounded-full transition-all",
                                isDragging
                                    ? "bg-blue-500/20 text-blue-400 scale-110"
                                    : "bg-gray-800 text-gray-400 group-hover:text-blue-400 group-hover:bg-blue-500/10 group-hover:scale-105"
                            )}>
                                <FileUp className="w-8 h-8" />
                            </div>
                            <div className="space-y-1">
                                <p className={clsx(
                                    "text-sm font-medium transition-colors",
                                    isDragging ? "text-blue-400" : "text-gray-300 group-hover:text-blue-300"
                                )}>
                                    Click or drop file here
                                </p>
                                <p className="text-xs text-gray-500">Supports PDF, DOCX, TXT</p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {message && (
                <div
                    className={clsx(
                        "mt-3 text-xs flex items-center justify-center gap-2 p-3 rounded-lg border",
                        status === 'success'
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                    )}
                >
                    {status === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span className="font-medium">{message}</span>
                </div>
            )}
        </div>
    );
};
