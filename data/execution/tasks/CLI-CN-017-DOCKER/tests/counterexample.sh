awk '{print $10}' access.log | sort | uniq -c | sort -nr | awk '{print $1 " " $2}'
