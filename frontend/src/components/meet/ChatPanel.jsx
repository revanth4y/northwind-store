/**
 * ChatPanel
 * ─────────
 * Slide-in chat sidebar for the video conference meeting view.
 * Groups consecutive messages from the same sender to reduce visual noise.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { XIcon, SendIcon } from "lucide-react";

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * @param {{
 *   messages: Array<{ sender: string, data: string, socketId: string, ts: number, self: boolean }>,
 *   input: string,
 *   onInput: (v: string) => void,
 *   onSend: () => void,
 *   onClose: () => void,
 * }} props
 */
export function ChatPanel({ messages, input, onInput, onSend, onClose }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 36 }}
      className="flex w-72 shrink-0 flex-col border-l border-white/8 bg-neutral-900 xl:w-80"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-100">Meeting Chat</h3>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-xs text-neutral-500">
            No messages yet — say hello!
          </p>
        ) : (
          messages.map((msg, i) => {
            // Group consecutive messages from the same sender
            const prevMsg = messages[i - 1];
            const showSender = !prevMsg || prevMsg.self !== msg.self || prevMsg.socketId !== msg.socketId;

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex flex-col ${msg.self ? "items-end" : "items-start"} ${showSender ? "mt-3" : "mt-0.5"}`}
              >
                {showSender && (
                  <div className={`mb-0.5 flex items-baseline gap-2 px-1 ${msg.self ? "flex-row-reverse" : ""}`}>
                    <span className="text-[11px] font-semibold text-neutral-300">
                      {msg.self ? "You" : msg.sender}
                    </span>
                    <span className="text-[10px] text-neutral-600">{formatTime(msg.ts)}</span>
                  </div>
                )}
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 leading-snug
                    ${msg.self
                      ? "rounded-br-sm bg-primary text-primary-content"
                      : "rounded-bl-sm bg-neutral-750 bg-neutral-700 text-neutral-100"
                    }`}
                >
                  {msg.data}
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
        className="flex gap-2 border-t border-white/8 p-3"
      >
        <input
          type="text"
          className="flex-1 rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100
            placeholder-neutral-500 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
          placeholder="Message…"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={handleKey}
          maxLength={500}
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          type="submit"
          disabled={!input.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content
            shadow-md transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          <SendIcon className="size-4" />
        </motion.button>
      </form>
    </motion.aside>
  );
}
