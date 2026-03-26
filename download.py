#!/usr/bin/env python3
import sys
import io
import contextlib
from parth_dl import InstagramDownloader

def main():
    if len(sys.argv) < 2:
        print("Error: No URL provided", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    try:
        dl = InstagramDownloader(verbose=False)
        # Redirect stdout to suppress library's verbose output
        with contextlib.redirect_stdout(io.StringIO()):
            file_paths = dl.download(url)

        if isinstance(file_paths, list):
            for path in file_paths:
                print(path)
        else:
            print(file_paths)

    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
