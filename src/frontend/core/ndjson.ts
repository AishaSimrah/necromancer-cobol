export interface LineSplitter {
  /** Feed one chunk of text; returns complete lines found so far (newline stripped). */
  push(chunk: string): readonly string[];
  /** Call once the stream ends; returns a final trailing line if the stream didn't end in \n, else []. */
  flush(): readonly string[];
}

export function createLineSplitter(): LineSplitter {
  let buffer = "";
  return {
    push(chunk: string): readonly string[] {
      const parts = (buffer + chunk).split("\n");
      buffer = parts.pop() ?? "";
      return parts;
    },
    flush(): readonly string[] {
      const rest = buffer;
      buffer = "";
      return rest.length > 0 ? [rest] : [];
    },
  };
}
