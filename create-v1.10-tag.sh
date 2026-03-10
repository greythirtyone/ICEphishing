#!/bin/bash

# Script to create and push v1.10 tag to trigger Build and Release workflow
# This workflow is defined in .github/workflows/build-release.yml
#
# The build-release.yml workflow will:
# - Build binaries for Windows x64, Linux x64, macOS x64, and macOS arm64
# - Create a GitHub Release with auto-generated release notes
# - Attach all platform binaries as release assets
#
# Usage: ./create-v1.10-tag.sh

set -e

echo "========================================="
echo "Creating v1.10 Release Tag"
echo "========================================="
echo ""

# Check if tag already exists
if git rev-parse v1.10 >/dev/null 2>&1; then
    echo "⚠️  Tag v1.10 already exists locally."
    echo "If you want to recreate it, first delete it with: git tag -d v1.10"
    exit 1
fi

# Ensure we're on main and it's up to date
echo "→ Checking out main branch..."
git checkout main

echo "→ Pulling latest changes..."
git pull origin main

# Create the tag
echo "→ Creating tag v1.10..."
git tag v1.10

# Push the tag to trigger the workflow
echo "→ Pushing tag to origin..."
git push origin v1.10

echo ""
echo "========================================="
echo "✓ Tag v1.10 created and pushed!"
echo "========================================="
echo ""
echo "The 'Build and Release' workflow is now triggered."
echo ""
echo "Monitor progress at:"
echo "https://github.com/greythirtyone/ICEphishing/actions"
echo ""
echo "Once complete, the release will be available at:"
echo "https://github.com/greythirtyone/ICEphishing/releases/tag/v1.10"
echo ""
