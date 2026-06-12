import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../GameContext.jsx';

export default function Toast() {
  const { toast } = useGame();
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.key}
          className="toast"
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
        >
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
