ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 python3-pip curl nuclei metasploit-framework john libcrypt1 ca-certificates git build-essential cmake clang pkg-config autoconf automake libtool binwalk squashfs-tools && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages --no-cache-dir ubi_reader
COPY inspect.py /opt/dsh-toolbox/inspect.py
COPY diffcheck.py /opt/dsh-toolbox/diffcheck.py
RUN python3 /opt/dsh-toolbox/inspect.py 120 > /opt/dsh-toolbox/manifest.json
WORKDIR /workspace
ENTRYPOINT ["sleep", "infinity"]
