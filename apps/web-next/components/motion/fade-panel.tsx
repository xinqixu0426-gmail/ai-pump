'use client';

import { motion } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';

type FadePanelProps = HTMLMotionProps<'div'> & {
  delay?: number;
};

export function FadePanel({ delay = 0, className, children, ...props }: FadePanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
