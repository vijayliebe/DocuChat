import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw, File } from 'lucide-react';

interface FileListProps {
    refreshTrigger: number;
}

export const FileList: React.FC<FileListProps> = ({ refreshTrigger }) => {
    const [files, setFiles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            const response = await fetch(`${API_URL}/files`);
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Error fetching files:', response.status, errorText);
                throw new Error(`Failed to fetch files: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            setFiles(data.files || []);
        } catch (error) {
            console.error('Error fetching files:', error);
            // Set empty array on error to show empty state
            setFiles([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, [refreshTrigger]);

    const getFileIcon = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
    };

    return (
        <div className="flex-1 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between mb-3">
                <button
                    onClick={fetchFiles}
                    className="flex items-center gap-2 px-2 py-1 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 rounded-md transition-colors"
                    title="Refresh list"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                </button>
            </div>

            {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <div className="w-12 h-12 rounded-full bg-gray-800/50 flex items-center justify-center mb-3">
                        <File className="w-6 h-6 text-gray-600" />
                    </div>
                    <p className="text-sm text-gray-600">No files uploaded yet</p>
                    <p className="text-xs text-gray-700 mt-1">Upload files to get started</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {files.map((file, idx) => (
                        <li
                            key={`${file}-${idx}`}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-300 bg-gray-800/50 rounded-lg hover:bg-gray-800 border border-gray-700/30 hover:border-gray-700/50 transition-all cursor-default group"
                        >
                            {getFileIcon(file)}
                            <span className="truncate flex-1 font-medium">{file}</span>
                            <span className="text-xs text-gray-500 group-hover:text-gray-400">
                                {file.split('.').pop()?.toUpperCase()}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
