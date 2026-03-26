#!/usr/bin/env python3
import sys
from parth_dl import InstagramDownloader

def main():
    if len(sys.argv) < 2:
        print("Error: No URL provided", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    try:
        dl = InstagramDownloader(verbose=False)
        # download() returns a list of file paths (even for single media)
        file_paths = dl.download(url)

        # If it's a list, print each path on its own line
        if isinstance(file_paths, list):
            for path in file_paths:
                print(path)
        else:
            # In case it returns a single string (though unlikely)
            print(file_paths)

    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
