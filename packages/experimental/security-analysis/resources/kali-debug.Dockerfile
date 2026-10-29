FROM kalilinux/kali-rolling@sha256:30399bd65187e06525008dd13eecc2b3439d26a82b2c6b0ba32dee72bd843117

# Exact direct dependencies fail closed if the rolling repository retires them.
# The measured image ID and full dpkg manifest identify the runnable environment.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    gdb=18.1-3 gcc=4:16.1.0-3 libc6-dev=2.43-7 python3=3.14.7-3 \
    binutils=2.47-6 file=1:5.47-4 strace=7.2+ds-1+b1 \
    ltrace=0.7.91~git20230705.8eabf68-4+b1 radare2=6.0.4+dfsg-1 \
    python3-unicorn=2.1.4-4 python3-capstone=5.0.9-1 \
    && dpkg-query -W > /opt/dsh-debug-packages.tsv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["sleep", "infinity"]
