/**
 * Text translation component
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Copy, Download, Loader2 } from 'lucide-react';
import { Document, Paragraph, TextRun, Packer } from 'docx';
import type { Language, TranslateTextResponse } from '~/types';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { LanguageSelector } from './language-selector';
import { cn } from '~/lib/utils';

const MAX_CHARS = 10000;

type FileFormat = 'txt' | 'docx';

interface TranslationHistoryItem {
  id: string;
  text: string;
  translatedText: string;
  sourceLang: Language;
  targetLang: Language;
  timestamp: Date;
  cost?: number;
}

type TextTranslatorProps = {
  remainingUses?: number;
  lifetimeLimit?: number;
  getAccessToken: () => Promise<string | undefined>;
  onTranslationUsed?: (usage: NonNullable<TranslateTextResponse['usage']>) => void;
};

export function TextTranslator({
  remainingUses = 10,
  lifetimeLimit = 10,
  getAccessToken,
  onTranslationUsed,
}: TextTranslatorProps) {
  const sourceLang: Language = 'en'; // Fixed to English only
  const [targetLang, setTargetLang] = useState<Language>('zh');
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);
  const [copiedResult, setCopiedResult] = useState(false);
  const [fileFormat, setFileFormat] = useState<FileFormat>('docx');

  // Translation mutation
  const translateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.translateText({
        text: inputText,
        sourceLang,
        targetLang,
      }, getAccessToken);
      return response;
    },
    onSuccess: (data: TranslateTextResponse) => {
      setTranslatedText(data.translatedText);
      if (data.usage) {
        onTranslationUsed?.(data.usage);
      }

      // Add to history
      const historyItem: TranslationHistoryItem = {
        id: Date.now().toString(),
        text: inputText,
        translatedText: data.translatedText,
        sourceLang,
        targetLang,
        timestamp: new Date(),
        cost: data.cost,
      };
      setHistory((prev) => [historyItem, ...prev.slice(0, 4)]);
    },
  });

  // Cost estimation mutation (for future feature)
  // const estimateMutation = useMutation({
  //   mutationFn: async () => {
  //     if (!inputText.trim()) return null;
  //     return await apiClient.estimateTranslationCost(inputText, targetLang);
  //   },
  // });

  const handleTranslate = () => {
    if (!inputText.trim()) return;
    if (remainingUses <= 0) return;
    if (sourceLang === targetLang) {
      alert('Source and target languages must be different');
      return;
    }
    translateMutation.mutate();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(translatedText);
    setCopiedResult(true);
    setTimeout(() => setCopiedResult(false), 2000);
  };

  const handleDownload = async () => {
    if (!translatedText) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `translation_${targetLang}_${timestamp}`;

    if (fileFormat === 'txt') {
      // Download as TXT
      const blob = new Blob([translatedText], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      // Download as DOCX
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: translatedText.split('\n').map(
              (line) =>
                new Paragraph({
                  children: [new TextRun(line || ' ')], // Empty line if line is empty
                })
            ),
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleReset = () => {
    setInputText('');
    setTranslatedText('');
    translateMutation.reset();
  };

  const handleLoadFromHistory = (item: TranslationHistoryItem) => {
    setTargetLang(item.targetLang);
    setInputText(item.text);
    setTranslatedText(item.translatedText);
  };

  const charCount = inputText.length;
  const isOverLimit = charCount > MAX_CHARS;
  const canTranslate =
    Boolean(inputText.trim()) &&
    !isOverLimit &&
    sourceLang !== targetLang &&
    remainingUses > 0;

  return (
    <div className="space-y-6">
      {/* Language selector */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-col gap-2 rounded-lg border border-primary-500/25 bg-primary-500/10 px-4 py-3 text-sm text-neutral-200 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-white">
              {remainingUses > 0
                ? `${remainingUses} of ${lifetimeLimit} free lifetime translations left`
                : 'Free lifetime translations used'}
            </span>
            <span className="text-neutral-400">
              Paid access is required after the free allowance.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            {/* Source language - fixed to English */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-200">
                Source Language
              </label>
              <div className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-base text-neutral-400">
                🇬🇧 English (Fixed)
              </div>
            </div>

            {/* Target language selector */}
            <LanguageSelector
              label="Target Language"
              value={targetLang}
              onChange={setTargetLang}
              disabled={translateMutation.isPending}
              excludeLanguage="en"
            />
          </div>
        </CardContent>
      </Card>

      {/* Input and output */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Input Text</span>
              <span
                className={cn(
                  'text-sm font-normal',
                  isOverLimit ? 'text-red-400' : 'text-neutral-400'
                )}
              >
                {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </span>
            </CardTitle>
            <CardDescription>
              Enter the text you want to translate
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={translateMutation.isPending}
                placeholder="Type or paste your text here..."
                className={cn(
                  'w-full h-64 bg-neutral-900/50 border-2 rounded-lg px-4 py-3 text-base text-white',
                  'placeholder:text-neutral-500 resize-none',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'transition-all duration-200',
                  isOverLimit ? 'border-red-500' : 'border-neutral-700'
                )}
              />

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleTranslate}
                  disabled={!canTranslate || translateMutation.isPending}
                  className="flex-1"
                >
                  {translateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      {remainingUses > 0 ? 'Translate' : 'Free limit reached'}
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={!inputText}
                >
                  Clear
                </Button>
              </div>

              {inputText.trim() && !isOverLimit && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-neutral-400"
                >
                  {remainingUses > 0
                    ? `${remainingUses} free ${
                        remainingUses === 1 ? 'translation' : 'translations'
                      } available for this account.`
                    : 'You have used the free lifetime translation allowance.'}
                </motion.div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Output */}
        <Card>
          <CardHeader>
            <CardTitle>Translation Result</CardTitle>
            <CardDescription>
              {translateMutation.isPending && 'Translating your text...'}
              {translateMutation.isSuccess && 'Translation complete'}
              {translateMutation.isError && 'Translation failed'}
              {!translateMutation.isPending &&
                !translateMutation.isSuccess &&
                !translateMutation.isError &&
                'Translation will appear here'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div
                className={cn(
                  'w-full h-64 bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-base text-white',
                  'overflow-y-auto'
                )}
              >
                <AnimatePresence mode="wait">
                  {translateMutation.isPending && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center justify-center h-full"
                    >
                      <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
                    </motion.div>
                  )}

                  {translateMutation.isSuccess && translatedText && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      {translatedText}
                    </motion.div>
                  )}

                  {translateMutation.isError && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-red-400"
                    >
                      Error:{' '}
                      {translateMutation.error?.message || 'Translation failed'}
                    </motion.div>
                  )}

                  {!translateMutation.isPending &&
                    !translateMutation.isSuccess &&
                    !translateMutation.isError && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-neutral-500 text-center h-full flex items-center justify-center"
                      >
                        Your translation will appear here
                      </motion.div>
                    )}
                </AnimatePresence>
              </div>

              {translatedText && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      onClick={handleCopy}
                      className="flex-1"
                    >
                      <Copy className="h-4 w-4" />
                      {copiedResult ? 'Copied!' : 'Copy'}
                    </Button>

                    <div className="flex gap-2 flex-1">
                      <select
                        value={fileFormat}
                        onChange={(e) =>
                          setFileFormat(e.target.value as FileFormat)
                        }
                        className="bg-neutral-800 border-2 border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                      >
                        <option value="docx">DOCX</option>
                        <option value="txt">TXT</option>
                      </select>

                      <Button
                        variant="outline"
                        onClick={handleDownload}
                        className="flex-1"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>

                  {translateMutation.data?.cost && (
                    <span className="text-sm text-neutral-400">
                      Cost: ${translateMutation.data.cost.toFixed(4)}
                    </span>
                  )}
                </motion.div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Translation history */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Translations</CardTitle>
            <CardDescription>
              Click to reuse a previous translation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {history.map((item) => (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => handleLoadFromHistory(item)}
                  className="w-full text-left p-4 rounded-lg border border-neutral-800 bg-neutral-900/50 hover:border-primary-500/50 hover:bg-neutral-900/80 transition-all duration-200"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-neutral-400">
                      {item.sourceLang.toUpperCase()} →{' '}
                      {item.targetLang.toUpperCase()}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {item.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-white line-clamp-2">{item.text}</p>
                  <ArrowRight className="h-3 w-3 inline mx-2 text-neutral-600" />
                  <p className="text-sm text-neutral-400 line-clamp-2">
                    {item.translatedText}
                  </p>
                </motion.button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
