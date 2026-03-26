#!/usr/bin/env python3
import sys
import json
import os
import tempfile
from pathlib import Path
from parth_dl import InstagramDownloader

def main():
    if len(sys.argv) < 2:
        print("Error: No URL provided", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    # Create a temporary directory for downloads
    temp_dir = tempfile.mkdtemp(prefix="ig_")
    try:
        dl = InstagramDownloader(verbose=False)
        result = dl.download(url, output_dir=temp_dir)
        # result could be a list of file paths (for carousels) or a single path
        if isinstance(result, list):
            # Output each file path on a new line
            for file_path in result:
                print(file_path)
        else:
            print(result)
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        # Optionally clean up the temp directory later (bot will handle)
        pass

if __name__ == "__main__":
    main()
