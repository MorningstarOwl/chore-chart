ARG BUILD_FROM
FROM ${BUILD_FROM}

# Add-on data (/data) belongs to root, so the add-on runs the server as root.
USER root

# 172.30.32.2 is Home Assistant's ingress proxy; 'self' lets HA show the page in its panel.
ENV CHORE_DATA_DIR=/data \
    CHORE_TRUSTED_PROXY=172.30.32.2 \
    CHORE_FRAME_ANCESTORS="'self'"

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
