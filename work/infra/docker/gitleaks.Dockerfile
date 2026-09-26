# gitleaks with the repository baked in.
#
# The binary rather than the GitHub Action, because that Action requires a paid organisation
# licence. Baking the repository in keeps the scan working on the containerized CI runner, where a
# bind-mount would not resolve.

FROM zricethezav/gitleaks:v8.24.0

COPY . /repo
WORKDIR /repo
