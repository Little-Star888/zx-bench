awk '{print $9}' access.log | sort | uniq -c | sort -nr | awk '{print $1 " " $2}'
