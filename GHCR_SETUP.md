# Fixing GHCR Permission Denied Error

## Problem
GitHub Actions workflow fails with:
```
denied: permission_denied: write_package
```

## Solution

### Step 1: Enable GitHub Actions Permissions

1. Go to your repository on GitHub
2. Click **Settings** tab
3. In the left sidebar, click **Actions** → **General**
4. Scroll down to **Workflow permissions**
5. Select **"Read and write permissions"**
6. Check **"Allow GitHub Actions to create and approve pull requests"** (optional)
7. Click **Save**

### Step 2: Configure Package Permissions

1. Go to your repository on GitHub
2. Click **Settings** tab
3. In the left sidebar, click **Actions** → **General**
4. Scroll down to **Artifact and log retention**
5. Make sure **Packages** section shows write access

### Step 3: Alternative - Use Personal Access Token (PAT)

If the above doesn't work, create a PAT:

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
2. Click **Generate new token (classic)**
3. Select scopes:
   - `repo` (full control of private repositories)
   - `write:packages` (upload packages to GitHub Package Registry)
   - `read:packages` (download packages from GitHub Package Registry)
4. Generate token and copy it

5. Add token as repository secret:
   - Go to repository Settings → Secrets and variables → Actions
   - Click **New repository secret**
   - Name: `GHCR_TOKEN`
   - Value: Your PAT token
   - Click **Add secret**

6. Update workflow file to use PAT:
   ```yaml
   - name: Log in to GitHub Container Registry
     uses: docker/login-action@v3
     with:
       registry: ${{ env.REGISTRY }}
       username: ${{ github.actor }}
       password: ${{ secrets.GHCR_TOKEN }}  # Changed from GITHUB_TOKEN
   ```

### Step 4: Verify Package Settings

1. Go to your profile on GitHub
2. Click **Packages** tab
3. Find your package (should be created after first successful push)
4. Click on it → **Package settings**
5. Under **Manage Actions access**, make sure your repository has **Write** access

## Testing

After making changes, trigger the workflow by pushing to main:
```bash
git commit --allow-empty -m "Trigger workflow"
git push origin main
```

## Common Issues

### Issue: Package name case sensitivity
GHCR converts repository names to lowercase. If your repo is `User/Repo`, the image will be `ghcr.io/user/repo`.

### Issue: Repository visibility
- **Public repos**: Anyone can pull, Actions can push
- **Private repos**: Make sure Actions has proper permissions

### Issue: First-time package creation
The first push to GHCR might fail if the package doesn't exist yet. GitHub should auto-create it, but sometimes you need to manually create it or use a PAT with `repo` scope.

## Current Workflow Configuration

The workflow in `.github/workflows/docker-build.yml` uses:
- `GITHUB_TOKEN` (default)
- `permissions: packages: write`
- `IMAGE_NAME: ${{ github.repository }}` (auto-detects repo name)

If issues persist, switch to using a Personal Access Token as described in Step 3.
