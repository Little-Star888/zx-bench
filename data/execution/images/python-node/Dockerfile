FROM python:3.12-alpine
COPY --from=node:22-alpine /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-alpine /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node:22-alpine /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=node:22-alpine /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
