mkdir -p archive; find in -type f -mtime +30 -exec mv {} archive/ \;
