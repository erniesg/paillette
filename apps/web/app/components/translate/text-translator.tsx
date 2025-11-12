/**
 * Text translation component
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Copy, RotateCcw, Loader2, DollarSign } from 'lucide-react';
import type { Language, TranslateTextResponse } from '~/types';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { LanguageSelector } from './language-selector';
import { cn } from '~/lib/utils';

const MAX_CHARS = 10000;

interface TranslationHistoryItem {
  id: string;
  text: string;
  translatedText: string;
  sourceLang: Language;
  targetLang: Language;
  timestamp: Date;
  cost?: number;
}

export function TextTranslator() {
  const [sourceLang, setSourceLang] = useState<Language>('en');
  const [targetLang, setTargetLang] = useState<Language>('zh');
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);
  const [copiedResult, setCopiedResult] = useState(false);

  // Translation mutation
  const translateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.translateText({
        text: inputText,
        sourceLang,
        targetLang,
      });
      return response;
    },
    onSuccess: (data: TranslateTextResponse) => {
      setTranslatedText(data.translatedText);

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

  const handleReset = () => {
    setInputText('');
    setTranslatedText('');
    translateMutation.reset();
  };

  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    if (translatedText) {
      setInputText(translatedText);
      setTranslatedText('');
    }
  };

  const handleLoadFromHistory = (item: TranslationHistoryItem) => {
    setSourceLang(item.sourceLang);
    setTargetLang(item.targetLang);
    setInputText(item.text);
    setTranslatedText(item.translatedText);
  };

  const charCount = inputText.length;
  const isOverLimit = charCount > MAX_CHARS;
  const canTranslate = inputText.trim() && !isOverLimit && sourceLang !== targetLang;

  return (
    <div className="space-y-6">
      {/* Language selectors */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <LanguageSelector
              label="Source Language"
              value={sourceLang}
              onChange={setSourceLang}
              disabled={translateMutation.isPending}
            />

            <div className="flex justify-center items-end pb-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSwapLanguages}
                disabled={translateMutation.isPending}
                title="Swap languages"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
            </div>

            <LanguageSelector
              label="Target Language"
              value={targetLang}
              onChange={setTargetLang}
              disabled={translateMutation.isPending}
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
            <CardDescription>Enter the text you want to translate</CardDescription>
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
                      Translate
                    </>
                  )}
                </Button>

                <Button variant="outline" onClick={handleReset} disabled={!inputText}>
                  Clear
                </Button>
              </div>

              {/* Cost estimate */}
              {inputText.trim() && !isOverLimit && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-neutral-400 flex items-center gap-2"
                >
                  <DollarSign className="h-4 w-4" />
                  <span>Estimated cost: Calculating...</span>
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
                      Error: {translateMutation.error?.message || 'Translation failed'}
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
                  className="flex items-center gap-3"
                >
                  <Button variant="outline" onClick={handleCopy} className="flex-1">
                    <Copy className="h-4 w-4" />
                    {copiedResult ? 'Copied!' : 'Copy'}
                  </Button>

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
            <CardDescription>Click to reuse a previous translation</CardDescription>
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
                      {item.sourceLang.toUpperCase()} → {item.targetLang.toUpperCase()}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {item.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-white line-clamp-2">{item.text}</p>
                  <ArrowRight className="h-3 w-3 inline mx-2 text-neutral-600" />
                  <p className="text-sm text-neutral-400 line-clamp-2">{item.translatedText}</p>
                </motion.button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
